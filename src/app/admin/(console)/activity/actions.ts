"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit, requirePermission, verifyTotp } from "@/lib/auth";
import { MFA_LIMIT, clientIp } from "@/lib/rate-limit-rules";
import { clearHits, overLimit } from "@/server/rate-limit";
import { clearStepUp, issueStepUp } from "@/lib/step-up";
import { verifyTurnstile } from "@/lib/turnstile";
import { safeActivityNext } from "@/lib/step-up-rules";

export interface StepUpState {
  error?: string;
}

/**
 * Open the activity log: a fresh authenticator code (and Turnstile, when
 * it's on) for a ten-minute pass. Tries are capped and every attempt is logged,
 * so a wrong code here after a right sign-in stands out in the log itself.
 */
export async function verifyStepUp(_prev: StepUpState, form: FormData): Promise<StepUpState> {
  const session = await requirePermission("audit:view");
  if (!session) return { error: "Only the owner can open the activity log." };

  const limitKey = `stepup:${session.adminUserId}`;
  if (await overLimit(limitKey, MFA_LIMIT)) {
    await audit(session, "STEP_UP_LOCKED", "AdminUser", session.adminUserId);
    return { error: "Too many codes tried. Wait 15 minutes and try again." };
  }

  const human = await verifyTurnstile(String(form.get("cf-turnstile-response") ?? "") || null, {
    ip: clientIp(await headers()),
    expectedAction: "audit-step-up",
    failOpen: false,
  });
  if (!human.ok) {
    await audit(session, "STEP_UP_FAILED", "AdminUser", session.adminUserId, { reason: `human check ${human.reason}` });
    return { error: human.reason === "unavailable" ? "The human check couldn't be reached. Try again in a minute." : "Complete the human check, then enter your code." };
  }

  const user = await db.adminUser.findUnique({ where: { id: session.adminUserId }, select: { mfaSecret: true } });
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!user?.mfaSecret || !/^\d{6}$/.test(code) || !verifyTotp(code, user.mfaSecret)) {
    await audit(session, "STEP_UP_FAILED", "AdminUser", session.adminUserId, { reason: "wrong code" });
    return { error: "That code isn't right. Check your authenticator and try again." };
  }

  await clearHits([limitKey]);
  const until = await issueStepUp(session);
  const untilText = until.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  await audit(session, "STEP_UP_OK", "AdminUser", session.adminUserId, { "access until": untilText });
  // Back to the activity page, or the export that asked for the check; never anywhere else.
  const next = String(form.get("next") ?? "");
  redirect(safeActivityNext(next));
}

/** End the pass now, e.g. before stepping away from the screen. */
export async function lockActivity(): Promise<void> {
  const session = await requirePermission("audit:view");
  await clearStepUp();
  if (session) await audit(session, "STEP_UP_LOCK", "AdminUser", session.adminUserId);
  redirect("/admin/activity/verify");
}
