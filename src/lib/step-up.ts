import "server-only";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { cookies, headers } from "next/headers";
import type { AdminSession } from "./auth";
import { STEP_UP_TTL_SECONDS, stepUpValid, type StepUpClaims } from "./step-up-rules";

/**
 * Step-up check for the activity log (docs/INTELLIGENCE.md).
 *
 * The log shows everyone's actions and IP addresses, so being signed in isn't
 * enough: the owner types a fresh authenticator code (and passes Cloudflare
 * Turnstile, when it's on) and gets a pass for ten minutes. The pass is a
 * short JWT in its own httpOnly, SameSite=Strict cookie, scoped to the
 * activity pages, and bound to:
 *   - the admin and their session version, so "reset access" or
 *     deactivation ends it at once;
 *   - this browser's user agent (a hash), so a copied cookie is worth less
 *     on another machine.
 * It signs with a key derived from JWT_SECRET for this purpose only, so a
 * sign-in token can never pass for a step-up token or the other way round.
 */

const COOKIE = "soulone_stepup";
const PATH = "/admin/activity";

function key(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET must be set to at least 32 characters.");
  return createHash("sha256").update(`step-up:audit:${secret}`).digest("hex");
}

async function agentHash(): Promise<string> {
  const ua = (await headers()).get("user-agent") ?? "";
  return createHash("sha256").update(ua).digest("base64url").slice(0, 22);
}

export async function issueStepUp(session: AdminSession): Promise<Date> {
  const claims: StepUpClaims = {
    sub: session.adminUserId,
    ver: session.sessionVersion ?? 0,
    scope: "audit",
    ua: await agentHash(),
  };
  const token = jwt.sign(claims, key(), { expiresIn: STEP_UP_TTL_SECONDS });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: PATH,
    maxAge: STEP_UP_TTL_SECONDS,
  });
  return new Date(Date.now() + STEP_UP_TTL_SECONDS * 1000);
}

/** When this admin's pass ends, or null when there's no valid pass. */
export async function stepUpExpiry(session: AdminSession): Promise<Date | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, key()) as StepUpClaims & { exp: number };
    return stepUpValid(decoded, { adminUserId: session.adminUserId, sessionVersion: session.sessionVersion ?? 0, ua: await agentHash() })
      ? new Date(decoded.exp * 1000)
      : null;
  } catch {
    return null;
  }
}

export async function clearStepUp(): Promise<void> {
  (await cookies()).set(COOKIE, "", { path: PATH, maxAge: 0 });
}
