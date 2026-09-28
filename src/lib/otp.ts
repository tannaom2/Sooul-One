import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export { maskMobile, normaliseMobile } from "./mobile";

/**
 * One-time sign-in codes sent by SMS. Pure rules, so they're unit-tested; the
 * database and SMS sides are in src/server/customer-auth.ts and src/lib/sms.ts.
 */

export const CODE_LENGTH = 6;
/** Long enough for a slow SMS on a weak network, short enough to be useless later. */
export const CODE_TTL_SECONDS = 5 * 60;
/** Wrong guesses allowed per code. Six digits and five tries: a 1 in 200,000 chance. */
export const MAX_ATTEMPTS = 5;
/** A new code for the same number only after this long, so a double tap sends one SMS. */
export const RESEND_AFTER_SECONDS = 30;

/** Uniformly random, leading zeros kept ("004271"). */
export function newCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/**
 * The stored form of a code. Keyed with a server secret and bound to this
 * challenge's row and number, so a leaked table can't be brute-forced
 * offline (a million codes is nothing without the key) or replayed for
 * another number.
 */
export function hashCode(code: string, challengeId: string, phone: string, secret: string): string {
  return createHmac("sha256", `otp:${secret}`).update(`${challengeId}|${phone}|${code}`).digest("hex");
}

export function codeMatches(code: string, challengeId: string, phone: string, secret: string, storedHash: string): boolean {
  if (!/^\d+$/.test(code) || code.length !== CODE_LENGTH) return false;
  const a = Buffer.from(hashCode(code, challengeId, phone, secret), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * How codes reach the shopper on this deployment.
 * - "sms": an SMS provider is set up (MSG91, with its DLT-approved template).
 * - "screen": no provider, on the owner's own machine (local development or
 *   the demo): the code is shown on the page, clearly labelled, and no SMS
 *   is sent. Never on a hosted server, whatever the flags say, because a
 *   code on the page is no proof of anything.
 * - "off": no provider on a real deployment. Phone sign-in is hidden and
 *   cash on delivery works as before, without a code.
 */
export type CodeDelivery = "sms" | "screen" | "off";

export interface DeliveryEnv {
  readonly MSG91_AUTH_KEY?: string;
  readonly MSG91_OTP_TEMPLATE_ID?: string;
  readonly SMS_SHOW_CODES?: string;
  readonly NODE_ENV?: string;
  readonly SITE_URL?: string;
  readonly RENDER?: string;
}

export function codeDelivery(env: DeliveryEnv): CodeDelivery {
  if (env.MSG91_AUTH_KEY && env.MSG91_OTP_TEMPLATE_ID) return "sms";
  if (env.RENDER || !isLocalSite(env.SITE_URL)) return "off";
  return env.NODE_ENV !== "production" || env.SMS_SHOW_CODES === "1" ? "screen" : "off";
}

function isLocalSite(siteUrl: string | undefined): boolean {
  if (!siteUrl) return true;
  try {
    const host = new URL(siteUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Seconds until another code may be sent, given when the last one was. 0 when it can go now. */
export function resendWait(lastSentAt: Date | null, now: Date): number {
  if (!lastSentAt) return 0;
  const elapsed = (now.getTime() - lastSentAt.getTime()) / 1000;
  return Math.max(0, Math.ceil(RESEND_AFTER_SECONDS - elapsed));
}
