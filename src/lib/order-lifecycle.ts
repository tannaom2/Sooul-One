/**
 * Which way an order may move, and what each move means. Staff moves come
 * through setOrderStatus (src/app/admin/actions.ts); payment moves come from
 * the Razorpay webhook (src/lib/payment-webhook.ts); abandoned orders are
 * closed by the expiry sweep (src/app/api/cron/expire-unpaid). Pure, so it's
 * tested directly.
 */

export type OrderStatus =
  | "PENDING_PAYMENT"
  | "PAID"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "REFUNDED"
  | "FAILED"
  | "RTO"
  | "RETURNED";

/** Moves staff can make from each status. Payment moves (PAID, FAILED, REFUNDED) are the webhook's alone. */
const STAFF_MOVES: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ["CANCELLED"],
  PAID: ["PROCESSING", "SHIPPED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "RTO"],
  DELIVERED: ["RETURNED"],
  FAILED: ["CANCELLED"],
  CANCELLED: [],
  REFUNDED: [],
  RTO: [],
  RETURNED: [],
};

export type ClosingStatus = "CANCELLED" | "RTO" | "RETURNED";

/** Why an order ended. Stored as the code; the label is what staff pick from. */
export const CLOSE_REASONS: Record<ClosingStatus, readonly { code: string; label: string }[]> = {
  CANCELLED: [
    { code: "CUSTOMER_REQUEST", label: "Customer asked to cancel" },
    { code: "UNCONFIRMED_COD", label: "Couldn't confirm the cash-on-delivery order" },
    { code: "OUT_OF_STOCK", label: "We couldn't fulfil it" },
    { code: "SUSPECTED_FRAUD", label: "Looks fraudulent" },
    { code: "PAYMENT_NOT_COMPLETED", label: "Payment was never completed" },
    { code: "OTHER", label: "Other" },
  ],
  RTO: [
    { code: "REFUSED_AT_DOOR", label: "Refused at the door" },
    { code: "UNREACHABLE", label: "Customer unreachable" },
    { code: "ADDRESS_ISSUE", label: "Address wrong or incomplete" },
    { code: "OTHER", label: "Other" },
  ],
  RETURNED: [
    { code: "DAMAGED", label: "Arrived damaged" },
    { code: "WRONG_ITEM", label: "Wrong item sent" },
    { code: "QUALITY", label: "Quality complaint" },
    { code: "OTHER", label: "Other" },
  ],
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  PROCESSING: "Packing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  FAILED: "Payment failed",
  RTO: "Returned undelivered (RTO)",
  RETURNED: "Returned by customer",
};

export interface OrderLike {
  readonly status: OrderStatus | string;
  /** Captured online. Cancelling these needs a refund, which arrives with live Razorpay. */
  readonly paidOnline: boolean;
}

export function isClosing(to: string): to is ClosingStatus {
  return to === "CANCELLED" || to === "RTO" || to === "RETURNED";
}

/** The moves staff may make now. A paid online order can't be cancelled until refunds exist. */
export function allowedMoves(order: OrderLike): OrderStatus[] {
  const moves = STAFF_MOVES[order.status as OrderStatus] ?? [];
  return moves.filter((to) => !(to === "CANCELLED" && order.paidOnline));
}

export type MoveCheck = { ok: true } | { ok: false; message: string };

export function checkMove(order: OrderLike, to: string, reason?: string | null): MoveCheck {
  if (!allowedMoves(order).includes(to as OrderStatus)) {
    if (to === "CANCELLED" && order.paidOnline) {
      return { ok: false, message: "This order was paid online, so cancelling it needs a refund. Refunds arrive with live Razorpay." };
    }
    const from = STATUS_LABELS[order.status as OrderStatus] ?? order.status;
    const into = STATUS_LABELS[to as OrderStatus] ?? to;
    return { ok: false, message: `An order that is ${from.toLowerCase()} can't be marked ${into.toLowerCase()}.` };
  }
  if (isClosing(to) && !CLOSE_REASONS[to].some((r) => r.code === reason)) {
    return { ok: false, message: "Choose a reason." };
  }
  return { ok: true };
}

/**
 * Whether the move puts the order's stock back on sale. Only a cancellation:
 * those goods never left. A parcel that comes back (RTO) or is returned may be
 * opened or damaged, and returned food must be checked before it's resold, so
 * staff add it back as a batch after inspection instead.
 */
export function releasesStock(to: string): boolean {
  return to === "CANCELLED";
}

/** Unpaid online orders are closed after this long, returning their stock. */
export const UNPAID_EXPIRY_MINUTES = 30;

/** An online order that was never paid and is past the expiry window. */
export function isAbandoned(order: { status: string; placedAt: Date }, now: Date): boolean {
  const waiting = order.status === "PENDING_PAYMENT" || order.status === "FAILED";
  return waiting && now.getTime() - order.placedAt.getTime() >= UNPAID_EXPIRY_MINUTES * 60_000;
}
