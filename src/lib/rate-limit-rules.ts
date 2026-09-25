/**
 * Who is asking, and how often they may. Pure, so the rules are unit-tested;
 * the counting itself is in src/server/rate-limit.ts.
 */

interface HeaderReader {
  get(name: string): string | null;
}

/**
 * The caller's IP address. On Render the request passes through Cloudflare,
 * which sets True-Client-IP / CF-Connecting-IP itself (a client can't forge
 * them), and Render puts the real client first in X-Forwarded-For. Locally
 * there are no proxy headers, so every request counts as "local".
 */
export function clientIp(h: HeaderReader): string {
  const direct = h.get("true-client-ip") ?? h.get("cf-connecting-ip");
  const forwarded = h.get("x-forwarded-for")?.split(",")[0];
  const ip = (direct ?? forwarded ?? h.get("x-real-ip") ?? "").trim();
  return ip ? ip.slice(0, 64) : "local";
}

export interface Limit {
  /** Attempts allowed per window. */
  readonly max: number;
  readonly windowSeconds: number;
}

const FIFTEEN_MINUTES = 15 * 60;

/**
 * Admin sign-in. A lock is keyed on the attacker's side, never the account
 * alone, so a stranger can't lock the owner out by typing their email five
 * times: they lock only themselves.
 * - one account from one IP: the old five-strikes rule, now per IP
 * - one IP across any accounts: stops a single machine guessing broadly
 * - one account from any IPs: a looser cap against guessing spread across many
 *   machines. Reaching it takes 30 failures inside 15 minutes.
 * A successful sign-in clears the account's counters.
 */
export const SIGN_IN_LIMITS = {
  accountFromIp: { max: 5, windowSeconds: FIFTEEN_MINUTES },
  ip: { max: 20, windowSeconds: FIFTEEN_MINUTES },
  account: { max: 30, windowSeconds: FIFTEEN_MINUTES },
} as const satisfies Record<string, Limit>;

export const SIGN_IN_WINDOW_SECONDS = FIFTEEN_MINUTES;

export function signInKeys(email: string, ip: string) {
  const account = email || "(blank)";
  return {
    accountFromIp: `signin:acct-ip:${account}|${ip}`,
    ip: `signin:ip:${ip}`,
    account: `signin:acct:${account}`,
  } as const;
}

/** True when any counter is past its limit. */
export function signInBlocked(counts: Record<keyof typeof SIGN_IN_LIMITS, number>): boolean {
  return (Object.keys(SIGN_IN_LIMITS) as (keyof typeof SIGN_IN_LIMITS)[]).some(
    (name) => counts[name] > SIGN_IN_LIMITS[name].max,
  );
}

/**
 * Public storefront endpoints, per IP. Deliberately generous: Indian mobile
 * carriers put many customers behind one IP address (carrier-grade NAT), so
 * these stop floods and scripts, never a busy evening. Each is several times
 * what one real shopper could do.
 */
export const PUBLIC_LIMITS = {
  /** Reviews are moderated anyway; this stops spam filling the queue. */
  reviews: { max: 10, windowSeconds: 60 * 60 },
  /** Each order holds stock, so scripted orders could empty the shelves. */
  createOrder: { max: 20, windowSeconds: 10 * 60 },
  /** Re-quotes as the shopper types; each one reads the basket and stock. */
  quote: { max: 300, windowSeconds: 10 * 60 },
  /** Each new pincode is a call to India Post on our behalf. */
  pincode: { max: 60, windowSeconds: 10 * 60 },
  /** Browser analytics events; a flood would bloat the events table. */
  events: { max: 600, windowSeconds: 10 * 60 },
} as const satisfies Record<string, Limit>;

export type PublicScope = keyof typeof PUBLIC_LIMITS;

/**
 * The second factor and first-time setup. Reaching these needs the right
 * password already, so they're keyed on the account.
 */
export const MFA_LIMIT: Limit = { max: 5, windowSeconds: FIFTEEN_MINUTES };
