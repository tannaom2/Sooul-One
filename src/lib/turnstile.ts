import "server-only";
import { reportError } from "@/lib/observability";

/**
 * Cloudflare Turnstile: a human check that most people never see (Cloudflare
 * decides from the browser's signals whether to ask anything at all). Used
 * where a script could do damage: placing orders (each holds stock), sending
 * sign-in codes (each text costs money), posting reviews (spam), and the
 * owner's step-up check before the activity log.
 *
 * Off until both keys are set (TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY),
 * so development, CI and the demo work without Cloudflare. Cloudflare's
 * published test keys (always pass / always fail) work on localhost.
 * The launch checklist lists it.
 *
 * Tokens are single-use and expire after 300 seconds; Cloudflare checks both.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileSiteKey(): string | null {
  return process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY ? process.env.TURNSTILE_SITE_KEY : null;
}

export function turnstileEnabled(): boolean {
  return turnstileSiteKey() !== null;
}

export type TurnstileResult = { ok: true } | { ok: false; reason: "missing" | "rejected" | "unavailable" };

/**
 * Verify a token with Cloudflare. `expectedAction` must match the widget's
 * action, so a token solved on one form can't be spent on another.
 *
 * If Cloudflare can't be reached, it fails closed for the owner's step-up
 * (there's no hurry) but open for checkout, where a Cloudflare outage must
 * not stop every order; rate limits still apply there.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  { ip, expectedAction, failOpen }: { ip?: string; expectedAction: string | readonly string[]; failOpen: boolean },
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!turnstileEnabled() || !secret) return { ok: true };
  if (!token || token.length > 2048) return { ok: false, reason: "missing" };
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "local") body.set("remoteip", ip);
    const response = await fetch(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(4000) });
    const result = (await response.json()) as { success?: boolean; action?: string; "error-codes"?: string[] };
    // Cloudflare's test keys return no action, so only a mismatching one is refused.
    const accepted = typeof expectedAction === "string" ? [expectedAction] : expectedAction;
    if (result.success && (!result.action || accepted.includes(result.action))) return { ok: true };
    return { ok: false, reason: "rejected" };
  } catch (error) {
    reportError("turnstile", error, { expectedAction });
    return failOpen ? { ok: true } : { ok: false, reason: "unavailable" };
  }
}
