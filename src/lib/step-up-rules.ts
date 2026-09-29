/**
 * The rules for the activity log's step-up pass (src/lib/step-up.ts), kept
 * pure so they're unit-tested without cookies or a server.
 */

/** Ten minutes: long enough to read the log, short enough that a stolen pass soon dies. */
export const STEP_UP_TTL_SECONDS = 10 * 60;

export interface StepUpClaims {
  readonly sub: string;
  readonly ver: number;
  readonly scope: "audit";
  readonly ua: string;
}

/** A decoded, signature-checked pass is good only for this admin, session version and browser. */
export function stepUpValid(claims: Partial<StepUpClaims>, current: { adminUserId: string; sessionVersion: number; ua: string }): boolean {
  return claims.scope === "audit" && claims.sub === current.adminUserId && claims.ver === current.sessionVersion && claims.ua === current.ua;
}
