/**
 * Referrals: the rules, pure and unit-tested. The database side is
 * src/server/referrals.ts.
 *
 * A friend who signs up through someone's link (or types their code) and is
 * genuinely new — their phone has never ordered, even as a guest — gets a
 * welcome discount on their first order. The referrer earns credit only when
 * that first order is delivered and the return window has passed, and only
 * up to the programme's cap per referrer. Credit is spent at most
 * `maxCreditPerOrder` per order, on orders over the minimum, never together
 * with a discount code.
 *
 * Stages:
 *   ATTRIBUTED ─first order placed─▶ QUALIFYING ─delivered─▶ HELD ─window passes─▶ REWARDED
 *        │                              │ └─cancelled─▶ back to ATTRIBUTED (they can order again)
 *        └─no order in time─▶ EXPIRED   └─returned to seller / returned / refunded─▶ VOID
 */

import type { Paise } from "./money";

export type ReferralStatus = "ATTRIBUTED" | "QUALIFYING" | "HELD" | "REWARDED" | "VOID" | "EXPIRED";

export const REFERRAL_MOVES: Record<ReferralStatus, readonly ReferralStatus[]> = {
  ATTRIBUTED: ["QUALIFYING", "EXPIRED", "VOID"],
  QUALIFYING: ["HELD", "ATTRIBUTED", "VOID"],
  HELD: ["REWARDED", "VOID"],
  REWARDED: [],
  VOID: [],
  EXPIRED: [],
};

export function canMove(from: ReferralStatus, to: ReferralStatus): boolean {
  return REFERRAL_MOVES[from].includes(to);
}

export type OrderMilestone = "PLACED" | "DELIVERED" | "CANCELLED" | "RTO" | "RETURNED" | "REFUNDED";

/** What an order milestone does to its referral: the new stage (and why, for a void), or null for no change. */
export function referralAfter(
  status: ReferralStatus,
  milestone: OrderMilestone,
): { to: ReferralStatus; reason?: string } | null {
  switch (milestone) {
    case "PLACED":
      return status === "ATTRIBUTED" ? { to: "QUALIFYING" } : null;
    case "DELIVERED":
      return status === "QUALIFYING" ? { to: "HELD" } : null;
    case "CANCELLED":
      // Nothing was delivered: the friend is still new and can order again.
      return status === "QUALIFYING" ? { to: "ATTRIBUTED" } : null;
    case "RTO":
    case "RETURNED":
    case "REFUNDED": {
      const reason = milestone === "RTO" ? "first_order_not_delivered" : "first_order_returned";
      return status === "QUALIFYING" || status === "HELD" ? { to: "VOID", reason } : null;
    }
  }
}

/** The order status an admin or webhook moved to, as a referral milestone. */
export function milestoneFor(orderStatus: string): OrderMilestone | null {
  switch (orderStatus) {
    case "DELIVERED":
      return "DELIVERED";
    case "CANCELLED":
      return "CANCELLED";
    case "RTO":
      return "RTO";
    case "RETURNED":
      return "RETURNED";
    case "REFUNDED":
      return "REFUNDED";
    default:
      return null;
  }
}

// --------------------------------------------------------------------------
// Codes
// --------------------------------------------------------------------------

/** No 0/O or 1/I/L: codes get read out over the phone and typed from WhatsApp. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "ASHA7K2": up to four letters of the first name, then three random characters. */
export function makeReferralCode(name: string, random: () => number): string {
  const letters = (name.normalize("NFKD").toUpperCase().match(/[A-Z]/g) ?? []).join("").slice(0, 4) || "SOUL";
  let tail = "";
  for (let i = 0; i < 3; i++) tail += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return letters + tail;
}

/** Tidies a typed or linked code; null when it can't be one. */
export function cleanCode(input: string | null | undefined): string | null {
  const code = (input ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length >= 4 && code.length <= 12 ? code : null;
}

// --------------------------------------------------------------------------
// Who gets money off this order
// --------------------------------------------------------------------------

export interface ProgramRules {
  readonly isActive: boolean;
  readonly refereeRewardPaise: Paise;
  readonly minOrderPaise: Paise;
  readonly maxCreditPerOrderPaise: Paise;
}

export interface CreditContext {
  /** The shopper is a referred friend whose first order hasn't been placed yet. */
  readonly welcomePending: boolean;
  readonly walletAvailablePaise: Paise;
}

/**
 * The credit to offer on this order, before the order's value is known: the
 * quote then applies it only if the order reaches the minimum and no code applies.
 */
export function creditOffer(rules: ProgramRules, ctx: CreditContext): { kind: "WALLET" | "WELCOME"; amountPaise: Paise; minOrderPaise: Paise } | null {
  if (!rules.isActive) return null;
  if (ctx.welcomePending && rules.refereeRewardPaise > 0) {
    return { kind: "WELCOME", amountPaise: rules.refereeRewardPaise, minOrderPaise: rules.minOrderPaise };
  }
  const amount = Math.min(rules.maxCreditPerOrderPaise, ctx.walletAvailablePaise);
  return amount > 0 ? { kind: "WALLET", amountPaise: amount, minOrderPaise: rules.minOrderPaise } : null;
}

// --------------------------------------------------------------------------
// Abuse: hard blocks, then signals that add up to a review
// --------------------------------------------------------------------------

export type AttributionBlock =
  | "PROGRAMME_OFF"
  | "UNKNOWN_CODE"
  | "CODE_OFF"
  | "OWN_CODE"
  | "ALREADY_REFERRED"
  | "ALREADY_A_REFERRER"
  | "NOT_NEW_CUSTOMER"
  | "CAP_REACHED";

export interface AttributionFacts {
  readonly programmeActive: boolean;
  readonly codeFound: boolean;
  readonly codeActive: boolean;
  readonly refereeIsReferrer: boolean;
  readonly refereeAlreadyReferred: boolean;
  /**
   * The would-be friend has referred someone themselves. Someone already
   * bringing people in isn't a new customer to win, and without this A
   * (signed up, never ordered) could refer B and then be referred back by B,
   * each earning from the other.
   */
  readonly refereeHasReferred: boolean;
  /** Orders ever placed with the friend's phone or account, guest orders included. */
  readonly refereePriorOrders: number;
  readonly rewardsIssued: number;
  readonly maxRewards: number;
  readonly refereeDiscountAfterCap: boolean;
}

/** Why this sign-up can't be a referral, or null when it can. */
export function attributionBlock(f: AttributionFacts): AttributionBlock | null {
  if (!f.programmeActive) return "PROGRAMME_OFF";
  if (!f.codeFound) return "UNKNOWN_CODE";
  if (!f.codeActive) return "CODE_OFF";
  if (f.refereeIsReferrer) return "OWN_CODE";
  if (f.refereeAlreadyReferred) return "ALREADY_REFERRED";
  if (f.refereeHasReferred) return "ALREADY_A_REFERRER";
  if (f.refereePriorOrders > 0) return "NOT_NEW_CUSTOMER";
  if (f.rewardsIssued >= f.maxRewards && !f.refereeDiscountAfterCap) return "CAP_REACHED";
  return null;
}

export const BLOCK_MESSAGES: Record<AttributionBlock, string> = {
  PROGRAMME_OFF: "Referral offers aren't running right now.",
  UNKNOWN_CODE: "We couldn't find that referral code. Check it and try again.",
  CODE_OFF: "That referral code isn't active any more.",
  OWN_CODE: "That's your own referral code. Share it with a friend instead.",
  ALREADY_REFERRED: "You've already been referred by someone.",
  ALREADY_A_REFERRER: "Referral offers are for new customers, and you've already invited friends yourself.",
  NOT_NEW_CUSTOMER: "Referral offers are for first orders, and this number has ordered with us before.",
  CAP_REACHED: "That referral code has been used as many times as it can be.",
};

export interface RiskSignals {
  /** The friend signed in from a browser the referrer has used. */
  readonly sameDevice: boolean;
  /** The first order goes to an address the referrer has used. */
  readonly sameAddress: boolean;
  /** The first order's email is one the referrer has used. */
  readonly sameEmail: boolean;
  /** Referrals this referrer has picked up in the last 24 hours, this one included. */
  readonly referralsLast24h: number;
}

export const RISK_WEIGHTS = { sameAddress: 60, sameDevice: 40, sameEmail: 40, burst: 20 } as const;
/** More than this many new referrals a day for one person is unusual. */
export const BURST_PER_DAY = 3;

export function riskScore(s: RiskSignals): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (s.sameAddress) (score += RISK_WEIGHTS.sameAddress), reasons.push("Delivers to an address the referrer uses");
  if (s.sameDevice) (score += RISK_WEIGHTS.sameDevice), reasons.push("Signed up on a browser the referrer uses");
  if (s.sameEmail) (score += RISK_WEIGHTS.sameEmail), reasons.push("Uses an email the referrer uses");
  if (s.referralsLast24h > BURST_PER_DAY) (score += RISK_WEIGHTS.burst), reasons.push(`${s.referralsLast24h} referrals in a day`);
  return { score, reasons };
}

/**
 * One address, however it was typed: "D-502, Shilp Apts." and "d502 shilp
 * apartments" match. Lowercased, punctuation and filler words removed, with
 * the pincode.
 */
export function normaliseAddress(a: { line1?: string | null; line2?: string | null; postalCode?: string | null }): string {
  const filler = /\b(flat|house|no|number|apartment|apartments|apts?|society|soc|road|rd|street|st|near|opp|opposite|nr)\b/g;
  const text = `${a.line1 ?? ""} ${a.line2 ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(filler, " ")
    .replace(/\s+/g, "");
  return `${text}|${(a.postalCode ?? "").replace(/\D/g, "")}`;
}

/** Credits already issued this calendar month plus this one would pass the budget. */
export function overMonthlyBudget(issuedThisMonthPaise: Paise, rewardPaise: Paise, budgetPaise: Paise | null): boolean {
  return budgetPaise != null && issuedThisMonthPaise + rewardPaise > budgetPaise;
}

/** "Mansi N.": enough for the referrer to recognise a friend, no more. */
export function friendLabel(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A friend";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}
