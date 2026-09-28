/**
 * Shopper sessions: the cookie, and when a session in use gets extended.
 * Pure and edge-safe, so src/proxy.ts and src/server/customer-auth.ts share it.
 *
 * A session lasts 90 days and slides: while it's being used, it keeps being
 * extended, so a regular shopper isn't signed out on day 90 because of a
 * date they never saw. Two limits keep that safe:
 *   - it's only extended once less than 60 days are left, so an active
 *     shopper costs one database write a month, not one per page;
 *   - it never runs past a year from sign-in, when a fresh code is asked for.
 * Signing out, or "sign out on every device", still ends it at once.
 */

export const CUSTOMER_COOKIE = "soulone_customer";
export const SESSION_DAYS = 90;
const RENEW_WHEN_DAYS_LEFT = 60;
const ABSOLUTE_MAX_DAYS = 365;
const DAY = 24 * 60 * 60 * 1000;

export const CUSTOMER_COOKIE_OPTIONS = {
  httpOnly: true,
  // Lax, not Strict: a shopper following a link from WhatsApp or email
  // should arrive signed in. Server actions check the origin anyway.
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60,
};

/** The session's new expiry if it's due an extension now, or null to leave it. */
export function renewedExpiry(session: { expiresAt: Date; createdAt: Date }, now: Date): Date | null {
  if (session.expiresAt <= now) return null; // ended: a fresh sign-in, not an extension
  if (session.expiresAt.getTime() - now.getTime() > RENEW_WHEN_DAYS_LEFT * DAY) return null;
  const cap = session.createdAt.getTime() + ABSOLUTE_MAX_DAYS * DAY;
  const next = Math.min(now.getTime() + SESSION_DAYS * DAY, cap);
  return next > session.expiresAt.getTime() ? new Date(next) : null;
}
