/**
 * The emails after an order (benchmark gap R5): a delivered note with how to
 * take what arrived, a check-in a week later, a review request at two weeks,
 * and a note when a refund is processed. Pure rules, tested directly
 * (tests/follow-ups.test.ts); sending is src/server/follow-ups.ts.
 *
 * The delivered and refund emails are service messages about the order. The
 * check-in and review request ask something of the shopper, so each carries a
 * one-tap stop, kept as a consent record (purpose ORDER_FOLLOW_UP), and
 * neither ever carries an offer.
 */

export const FOLLOW_UP_PURPOSE = "ORDER_FOLLOW_UP";

/** Days after delivery. */
export const CHECK_IN_DAYS = 7;
export const REVIEW_REQUEST_DAYS = 14;

/** Follow-ups go at 10 am India time, not whenever the parcel was marked delivered. */
const SEND_HOUR_IST = 10;
const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** 10 am IST on the India-time day `days` after `from`. */
export function morningIST(from: Date, days: number): Date {
  const istMidnight = Math.floor((from.getTime() + IST_MS) / DAY_MS) * DAY_MS;
  return new Date(istMidnight + days * DAY_MS + SEND_HOUR_IST * 60 * 60 * 1000 - IST_MS);
}

export const followUpKey = {
  delivered: (orderId: string) => `delivered_notice:${orderId}`,
  checkIn: (orderId: string) => `check_in:${orderId}`,
  reviewRequest: (orderId: string) => `review_request:${orderId}`,
  /** Per refund, so a second partial refund gets its own note. */
  refund: (orderId: string, refundId: string | null) => `refund_notice:${orderId}:${refundId ?? "order"}`,
};

/** Only a delivered order can be reviewed from: one that came back or was refunded can't. */
export const canReviewFrom = (status: string) => status === "DELIVERED";

interface Line {
  readonly productId: string;
  readonly productNameSnapshot: string;
}

/** Each product in the order once, in order, less the ones already reviewed from it. */
export function reviewableItems<T extends Line>(items: readonly T[], reviewed: Iterable<string>): T[] {
  const done = new Set(reviewed);
  const seen = new Set<string>();
  return items.filter((i) => {
    if (done.has(i.productId) || seen.has(i.productId)) return false;
    seen.add(i.productId);
    return true;
  });
}

interface UsageLine {
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly product: { readonly regulatoryType: string; readonly dosageGuidance: string | null };
}

/**
 * How to take each supplement in the order, in the words on its label (the
 * product's dosage guidance, which the claims check has already seen). Snacks
 * need no instructions. One line per product.
 */
export function howToTake(items: readonly UsageLine[]): { name: string; guidance: string }[] {
  const seen = new Set<string>();
  const out: { name: string; guidance: string }[] = [];
  for (const i of items) {
    const guidance = i.product.dosageGuidance?.trim();
    if (i.product.regulatoryType !== "HEALTH_SUPPLEMENT" || !guidance || seen.has(i.productId)) continue;
    seen.add(i.productId);
    out.push({ name: i.productNameSnapshot, guidance });
  }
  return out;
}

/** A suggested public name from the delivery name: first name and last initial ("Asha R."). */
export function suggestedReviewName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
