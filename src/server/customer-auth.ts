import "server-only";
import { basketOnSignIn, startFreshBasket } from "@/server/cart";
import { reportError } from "@/lib/observability";
import type { SignInBasketMode } from "@/lib/basket-sign-in";
import { cache } from "react";
import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  CODE_TTL_SECONDS,
  MAX_ATTEMPTS,
  RESEND_AFTER_SECONDS,
  codeDelivery,
  codeMatches,
  hashCode,
  maskMobile,
  newCode,
  normaliseMobile,
  resendWait,
} from "@/lib/otp";
import { OTP_LIMITS, clientIp, otpKeys } from "@/lib/rate-limit-rules";
import { overLimit } from "@/server/rate-limit";
import { sendCodeSms } from "@/lib/sms";
import { asAddress } from "@/lib/stored-order";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { CUSTOMER_COOKIE, CUSTOMER_COOKIE_OPTIONS, SESSION_DAYS, renewedExpiry } from "@/lib/customer-session";
import { attributeReferral, forgetCode, rememberedCode } from "@/server/referrals";

/**
 * Shopper sign-in: a mobile number proven by a one-time SMS code.
 *
 * Kept apart from the owner console's sign-in (src/lib/auth.ts): its own
 * cookie, its own tables, no shared code. A bug here must never be a way into
 * the console.
 *
 * There's no separate "sign up". Proving a number creates the account the
 * first time, and every time links the guest orders placed with that number
 * in the last year, so a shopper who checked out as a guest finds their
 * orders waiting. Whether a number has an account is never revealed: every
 * number gets the same "code sent".
 */

export { CUSTOMER_COOKIE };
/** Guest orders older than this aren't linked: the number may have belonged to someone else then (recycled SIMs). */
const LINK_ORDERS_MONTHS = 12;

export interface SignedInCustomer {
  readonly id: string;
  readonly phone: string | null;
  readonly name: string;
  readonly email: string | null;
}

export type SendCodeResult =
  | { ok: true; sentTo: string; resendIn: number; demoCode?: string }
  | { ok: false; message: string; resendIn?: number };

export type VerifyCodeResult = { ok: true; referral?: string } | { ok: false; message: string; expired?: boolean };

const NOT_AVAILABLE = "Signing in with your mobile number isn't available yet.";
const BAD_NUMBER = "Enter a 10-digit Indian mobile number.";

/** How codes reach shoppers here (src/lib/otp.ts). */
export function codeDeliveryHere() {
  return codeDelivery(process.env);
}

/** Cash on delivery asks for a code whenever codes can be sent at all. */
export function codRequiresCode(): boolean {
  return codeDeliveryHere() !== "off";
}

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error("JWT_SECRET must be set to at least 32 characters.");
  return value;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function sendSignInCode(rawPhone: string): Promise<SendCodeResult> {
  const delivery = codeDeliveryHere();
  if (delivery === "off") return { ok: false, message: NOT_AVAILABLE };
  const phone = normaliseMobile(rawPhone);
  if (!phone) return { ok: false, message: BAD_NUMBER };

  const now = new Date();
  const last = await db.phoneOtp.findFirst({ where: { phone }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const wait = resendWait(last?.createdAt ?? null, now);
  if (wait > 0) return { ok: false, message: `You can ask for another code in ${wait} seconds.`, resendIn: wait };

  const keys = otpKeys(phone, clientIp(await headers()));
  if ((await overLimit(keys.sendPerIp, OTP_LIMITS.sendPerIp)) || (await overLimit(keys.sendPerPhone, OTP_LIMITS.sendPerPhone))) {
    return { ok: false, message: "Too many codes asked for. Wait a while and try again." };
  }

  const code = newCode();
  const id = randomUUID();
  // Only the newest code for a number works: any earlier one is retired.
  await db.$transaction([
    db.phoneOtp.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: now } }),
    db.phoneOtp.create({
      data: { id, phone, codeHash: hashCode(code, id, phone, secret()), expiresAt: new Date(now.getTime() + CODE_TTL_SECONDS * 1000) },
    }),
  ]);

  // Now and then, after the response, drop codes over a day old.
  if (Math.random() < 0.05) {
    after(() =>
      db.phoneOtp.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }).catch(() => undefined),
    );
  }

  if (delivery === "sms") {
    const sent = await sendCodeSms(phone, code, CODE_TTL_SECONDS / 60);
    if (!sent.delivered) {
      await db.phoneOtp.update({ where: { id }, data: { consumedAt: now } });
      return { ok: false, message: "We couldn't send the text just now. Try again in a minute." };
    }
    return { ok: true, sentTo: maskMobile(phone), resendIn: RESEND_AFTER_SECONDS };
  }

  // "screen": the owner's own machine, no SMS provider (local or demo).
  console.info(`[sms] No SMS provider set up; showing the code on screen instead. Code for ${maskMobile(phone)}: ${code}`);
  return { ok: true, sentTo: maskMobile(phone), resendIn: RESEND_AFTER_SECONDS, demoCode: code };
}

export async function verifySignInCode(rawPhone: string, rawCode: string, basket: SignInBasketMode = "follow"): Promise<VerifyCodeResult> {
  if (codeDeliveryHere() === "off") return { ok: false, message: NOT_AVAILABLE };
  const phone = normaliseMobile(rawPhone);
  if (!phone) return { ok: false, message: BAD_NUMBER };
  const code = rawCode.replace(/\D/g, "");

  const keys = otpKeys(phone, clientIp(await headers()));
  if (await overLimit(keys.verifyPerIp, OTP_LIMITS.verifyPerIp)) {
    return { ok: false, message: "Too many tries from your connection. Wait a few minutes and try again." };
  }

  const now = new Date();
  const challenge = await db.phoneOtp.findFirst({ where: { phone, consumedAt: null }, orderBy: { createdAt: "desc" } });
  if (!challenge || challenge.expiresAt <= now) {
    return { ok: false, message: "That code has expired. Ask for a new one.", expired: true };
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    return { ok: false, message: "Too many wrong tries. Ask for a new code.", expired: true };
  }
  if (!codeMatches(code, challenge.id, phone, secret(), challenge.codeHash)) {
    const updated = await db.phoneOtp.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    const left = MAX_ATTEMPTS - updated.attempts;
    return left > 0
      ? { ok: false, message: `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` }
      : { ok: false, message: "Too many wrong tries. Ask for a new code.", expired: true };
  }
  // Used once: of two requests racing with the same code, only one gets here.
  const consumed = await db.phoneOtp.updateMany({
    where: { id: challenge.id, consumedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    data: { consumedAt: now },
  });
  if (consumed.count === 0) return { ok: false, message: "That code has already been used. Ask for a new one.", expired: true };

  const customer = await claimNumber(phone, now);
  const deviceHash = await startSession(customer.id);
  // The account's basket follows it to this browser (never at checkout: "keep").
  // A problem here mustn't stop the sign-in.
  await basketOnSignIn(customer.id, basket).catch((error) => reportError("customer-auth/basket", error, { mode: basket }));

  // Arrived through a friend's link or code: this is where it counts, once the
  // number is proven. Whatever the outcome, the remembered code is used up.
  const friendCode = await rememberedCode();
  if (friendCode) {
    const referred = await attributeReferral({ refereeId: customer.id, code: friendCode, via: "LINK", deviceHash }).catch(() => null);
    await forgetCode();
    if (referred) return { ok: true, referral: referred.ok ? `Welcome! Your offer from ${referred.referrer} is ready at checkout.` : referred.message };
  }
  return { ok: true };
}

/**
 * The account for a proven number, created the first time. Links the guest
 * orders placed with it in the last year that aren't anyone's yet, and takes
 * a name from the most recent one if the account has none.
 */
async function claimNumber(phone: string, now: Date) {
  const since = new Date(now);
  since.setMonth(since.getMonth() - LINK_ORDERS_MONTHS);
  return db.$transaction(async (tx) => {
    const customer = await tx.customer.upsert({
      where: { phone },
      create: { phone, phoneVerifiedAt: now, lastSignInAt: now },
      update: { phoneVerifiedAt: now, lastSignInAt: now },
    });
    await tx.order.updateMany({
      where: { customerId: null, guestPhone: phone, placedAt: { gte: since } },
      data: { customerId: customer.id },
    });
    if (customer.name) return customer;
    const latest = await tx.order.findFirst({
      where: { customerId: customer.id },
      orderBy: { placedAt: "desc" },
      select: { shippingAddress: true },
    });
    const name = asAddress(latest?.shippingAddress)?.name?.trim();
    return name ? tx.customer.update({ where: { id: customer.id }, data: { name: name.slice(0, 120) } }) : customer;
  });
}

/** Starts a session and returns this browser's device hash (for the self-referral check). */
async function startSession(customerId: string): Promise<string | null> {
  const store = await cookies();
  const basket = store.get(SESSION_COOKIE)?.value;
  const deviceHash = basket ? sha256(basket) : null;
  // A sign-in always gets a new token, and any session this browser already
  // had ends, so a token planted beforehand is worthless.
  const previous = store.get(CUSTOMER_COOKIE)?.value;
  if (previous) await db.customerSession.deleteMany({ where: { tokenHash: sha256(previous) } });

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.customerSession.create({
    data: {
      tokenHash: sha256(token),
      customerId,
      userAgent: (await headers()).get("user-agent")?.slice(0, 200) ?? null,
      deviceHash,
      expiresAt,
    },
  });
  store.set(CUSTOMER_COOKIE, token, CUSTOMER_COOKIE_OPTIONS);
  return deviceHash;
}

/** The signed-in shopper, or null. Once per request. */
export const getCustomer = cache(async (): Promise<SignedInCustomer | null> => {
  const token = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = sha256(token);
  const session = await db.customerSession.findUnique({
    where: { tokenHash },
    select: { expiresAt: true, createdAt: true, customer: { select: { id: true, phone: true, name: true, email: true } } },
  });
  const now = new Date();
  if (!session || session.expiresAt <= now) return null;
  // In use, so it slides (src/lib/customer-session.ts): about one write a month
  // for an active shopper. The cookie's own expiry slides in src/proxy.ts.
  const renewed = renewedExpiry(session, now);
  if (renewed) await db.customerSession.update({ where: { tokenHash }, data: { expiresAt: renewed } }).catch(() => undefined);
  return session.customer;
});

/** Ends this browser's session, or every session the account has. */
export async function signOutCustomer({ everywhere }: { everywhere: boolean }): Promise<void> {
  const store = await cookies();
  const token = store.get(CUSTOMER_COOKIE)?.value;
  if (token) {
    const tokenHash = sha256(token);
    if (everywhere) {
      const session = await db.customerSession.findUnique({ where: { tokenHash }, select: { customerId: true } });
      if (session) await db.customerSession.deleteMany({ where: { customerId: session.customerId } });
    }
    await db.customerSession.deleteMany({ where: { tokenHash } });
  }
  store.delete(CUSTOMER_COOKIE);
  // The basket stays with the account; this browser starts an empty one.
  if (token) await startFreshBasket();
}
