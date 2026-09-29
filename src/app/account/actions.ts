"use server";

import { headers } from "next/headers";
import { verifyTurnstile } from "@/lib/turnstile";
import { clientIp } from "@/lib/rate-limit-rules";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  getCustomer,
  sendSignInCode,
  signOutCustomer,
  verifySignInCode,
  type SendCodeResult,
  type VerifyCodeResult,
} from "@/server/customer-auth";
import { reportError } from "@/lib/observability";
import { cleanCode } from "@/lib/referrals";
import { attributeReferral, invite, rememberCode, sha256 } from "@/server/referrals";
import { readSessionId } from "@/server/cart";

/**
 * Shopper sign-in actions. Used by the sign-in page and by checkout, where
 * cash on delivery asks for the code. They only ever act on the number typed
 * and this browser's own cookie.
 */

const TRY_AGAIN = "That didn't go through. Check your connection and try again.";
const phoneSchema = z.string().max(20);
const codeSchema = z.string().max(12);

/**
 * Text a sign-in code. With Cloudflare Turnstile on, a human-check token is
 * required (from the sign-in form, or checkout's own widget): each text costs
 * money, so a script can't run up the bill. Fails open if Cloudflare is
 * unreachable; the per-number and per-connection limits still apply.
 */
export async function requestSignInCode(phone: string, humanToken?: string | null): Promise<SendCodeResult> {
  const parsed = phoneSchema.safeParse(phone);
  if (!parsed.success) return { ok: false, message: "Enter a 10-digit Indian mobile number." };
  const human = await verifyTurnstile(humanToken, { ip: clientIp(await headers()), expectedAction: ["sms-code", "checkout"], failOpen: true });
  if (!human.ok) return { ok: false, message: "Tick the human check, then send the code." };
  try {
    return await sendSignInCode(parsed.data);
  } catch (error) {
    reportError("customer-auth/send", error);
    return { ok: false, message: TRY_AGAIN };
  }
}

export async function confirmSignInCode(phone: string, code: string): Promise<VerifyCodeResult> {
  const parsed = z.object({ phone: phoneSchema, code: codeSchema }).safeParse({ phone, code });
  if (!parsed.success) return { ok: false, message: "Enter the 6-digit code." };
  try {
    return await verifySignInCode(parsed.data.phone, parsed.data.code);
  } catch (error) {
    reportError("customer-auth/verify", error);
    return { ok: false, message: TRY_AGAIN };
  }
}

export async function signOut(): Promise<void> {
  await signOutCustomer({ everywhere: false });
  redirect("/");
}

export async function signOutEverywhere(): Promise<void> {
  await signOutCustomer({ everywhere: true });
  redirect("/");
}

/**
 * A code a friend passed on by word of mouth. Signed in, it's applied now
 * (same checks as a link); signed out, it's remembered until they sign in.
 */
export async function applyReferralCode(raw: string): Promise<{ ok: boolean; message: string }> {
  const code = cleanCode(typeof raw === "string" ? raw : "");
  if (!code) return { ok: false, message: "Enter the code your friend shared, like ASHA7K2." };
  try {
    const customer = await getCustomer();
    if (!customer) {
      if (!(await invite(code))) return { ok: false, message: "That code isn't active. Check it with your friend." };
      await rememberCode(code);
      return { ok: true, message: "Code saved. Sign in with your mobile number to use it on your first order." };
    }
    const basket = await readSessionId();
    const result = await attributeReferral({ refereeId: customer.id, code, via: "CODE", deviceHash: basket ? sha256(basket) : null });
    return result.ok
      ? { ok: true, message: `Done: your offer from ${result.referrer} comes off at checkout.` }
      : { ok: false, message: result.message };
  } catch (error) {
    reportError("referral/apply", error);
    return { ok: false, message: TRY_AGAIN };
  }
}
