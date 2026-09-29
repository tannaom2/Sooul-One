/**
 * Return-to-origin (RTO) risk for one order, 0–100, before it's dispatched.
 *
 * Rules, not a trained model: a new store has too few orders to train on, and
 * the owner has to be able to read why an order scored high and act on it
 * (call to confirm, ask for prepayment, or ship as normal). The signals are
 * the ones Indian D2C checkout and shipping tools publish as the strongest:
 * cash on delivery, a first-time buyer, an unconfirmed number, the pincode's
 * own record, the buyer's past refusals, a large COD cart, bulk quantities,
 * late-night orders and a thin address. docs/INTELLIGENCE.md has the table.
 *
 * Pure, so every rule is unit-tested (tests/intel.test.ts).
 */

export interface RiskInput {
  readonly cod: boolean;
  readonly totalPaise: number;
  /** All units in the order. */
  readonly units: number;
  /** The most units of any one product. */
  readonly maxUnitsOfOneProduct: number;
  readonly placedAt: Date;
  /** The number was proven by one-time code. */
  readonly phoneVerified: boolean;
  /** This buyer's earlier orders (same account or number): delivered, and came back. */
  readonly priorDelivered: number;
  readonly priorReturnedToOrigin: number;
  /** Of the delivered ones, how many were paid online: a buyer who has prepaid before rarely refuses. */
  readonly priorPrepaidDelivered: number;
  /** This buyer's other cash-on-delivery orders placed in the last 24 hours and not yet shipped. */
  readonly recentOpenCod: number;
  /** Shipped COD parcels to this pincode that finished, and how many came back. */
  readonly pincode: { readonly codFinished: number; readonly codReturned: number } | null;
  /** The store's COD return rate overall (0–1), the prior for thin pincodes. */
  readonly storeCodRtoRate: number;
  /** House, street and landmark as typed. */
  readonly address: string;
}

export interface RiskReason {
  readonly code: string;
  readonly label: string;
  readonly points: number;
}

export type RiskBand = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export interface RiskResult {
  readonly score: number;
  readonly band: RiskBand;
  readonly reasons: readonly RiskReason[];
}

/**
 * Bands and what each means for dispatch (docs/INTELLIGENCE.md): ship as
 * normal; confirm by message; call before packing; ask for prepayment.
 */
export const RISK_BANDS = { medium: 30, high: 60, veryHigh: 80 } as const;

export const BAND_ACTION: Record<RiskBand, string> = {
  LOW: "Ship as normal",
  MEDIUM: "Confirm by WhatsApp or SMS before packing",
  HIGH: "Call to confirm before packing",
  VERY_HIGH: "Ask for prepayment, or cancel if unreachable",
};

/** Orders over these (₹, incl. GST) are a bigger loss when refused at the door. */
export const COD_VALUE_STEPS = { raised: 1500_00, high: 3000_00 } as const;

/**
 * Pincode return rate with a pull towards the store's rate, so two refusals
 * out of two parcels doesn't read as "100% RTO". Five parcels' worth of prior.
 */
export function smoothedRate(returned: number, finished: number, prior: number, weight = 5): number {
  return (returned + prior * weight) / (finished + weight);
}

function istHour(date: Date): number {
  return new Date(date.getTime() + 5.5 * 60 * 60 * 1000).getUTCHours();
}

export function riskBand(score: number): RiskBand {
  if (score >= RISK_BANDS.veryHigh) return "VERY_HIGH";
  return score >= RISK_BANDS.high ? "HIGH" : score >= RISK_BANDS.medium ? "MEDIUM" : "LOW";
}

/**
 * An address typed to get past the form: keyboard runs, one character
 * repeated, or words with no vowels. Deliberately narrow, since Indian
 * addresses are full of short codes (A-104, B/2, GIDC) that are genuine.
 */
export function looksGibberish(address: string): boolean {
  const text = address.toLowerCase();
  if (/(.)\1{4,}/.test(text)) return true;
  if (/(asdf|qwer|zxcv|hjkl|sdfg|xcvb)/.test(text)) return true;
  const words = text.split(/[^a-z]+/).filter((w) => w.length >= 5);
  return words.length > 0 && words.filter((w) => !/[aeiouy]/.test(w)).length / words.length >= 0.5;
}

export function scoreRtoRisk(input: RiskInput): RiskResult {
  const reasons: RiskReason[] = [];
  const add = (code: string, label: string, points: number) => reasons.push({ code, label, points });

  if (input.cod) add("COD", "Cash on delivery", 25);

  const firstOrder = input.priorDelivered === 0 && input.priorReturnedToOrigin === 0;
  if (input.cod && firstOrder) add("FIRST_ORDER", "First order from this buyer", 15);
  if (input.cod && !input.phoneVerified) add("PHONE_UNVERIFIED", "Mobile number not confirmed by code", 10);

  if (input.priorReturnedToOrigin > 0) {
    add("PAST_RTO", `${input.priorReturnedToOrigin} earlier parcel${input.priorReturnedToOrigin === 1 ? "" : "s"} came back`, Math.min(40, 30 * input.priorReturnedToOrigin));
  }
  if (input.priorDelivered >= 3) add("LOYAL", `${input.priorDelivered} earlier orders delivered`, -20);
  else if (input.priorDelivered >= 1) add("DELIVERED_BEFORE", "Has taken delivery before", -10);
  if (input.cod && input.priorPrepaidDelivered >= 1) add("PREPAID_HISTORY", "Has paid online before", -10);
  if (input.cod && input.recentOpenCod >= 1) add("DUPLICATE_COD", "Another cash on delivery order from them in the last 24 hours", 15);

  if (input.pincode && input.storeCodRtoRate > 0) {
    const rate = smoothedRate(input.pincode.codReturned, input.pincode.codFinished, input.storeCodRtoRate);
    const ratio = rate / input.storeCodRtoRate;
    const pct = Math.round(rate * 100);
    // "High" needs at least two refusals behind it: one parcel is an anecdote.
    if (ratio >= 2 && input.pincode.codReturned >= 2) add("PINCODE_HIGH", `Pincode returns ${pct}% of COD parcels, over twice the usual`, 20);
    else if (ratio >= 1.5) add("PINCODE_RAISED", `Pincode returns ${pct}% of COD parcels`, 10);
    else if (ratio <= 0.5 && input.pincode.codFinished >= 5) add("PINCODE_GOOD", "Pincode rarely returns parcels", -5);
  }

  if (input.cod && input.totalPaise > COD_VALUE_STEPS.high) add("COD_VALUE_HIGH", "Large order to pay in cash", 20);
  else if (input.cod && input.totalPaise > COD_VALUE_STEPS.raised) add("COD_VALUE_RAISED", "Above-average order to pay in cash", 10);

  if (input.units >= 6 || input.maxUnitsOfOneProduct >= 3) add("BULK", "Unusually many units", 10);

  const hour = istHour(input.placedAt);
  if (hour >= 23 || hour < 5) add("LATE_NIGHT", "Placed between 11 pm and 5 am", 5);

  const address = input.address.trim();
  if (address.length < 15 || !/\d/.test(address)) add("THIN_ADDRESS", "Short address with no house number", 10);
  if (looksGibberish(address)) add("GIBBERISH_ADDRESS", "Address looks made up", 15);

  const score = Math.max(0, Math.min(100, reasons.reduce((sum, r) => sum + r.points, 0)));
  return { score, band: riskBand(score), reasons };
}
