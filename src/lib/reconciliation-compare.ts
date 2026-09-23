/**
 * Pure comparison logic for payment reconciliation.
 *
 * Deliberately has no "server-only" import and touches neither Prisma nor the
 * Razorpay SDK — kept separate from reconciliation.ts (which does both) so
 * this file, the part actually worth testing, can be imported by Vitest at
 * all. "server-only" isn't resolvable outside Next's own bundler, which is
 * why every file in this codebase that imports it stays untested directly;
 * pulling the pure logic out here is the same pattern src/lib/money.ts and
 * src/lib/checkout/quote.ts already use relative to their own callers.
 */

export type FindingKind =
  | "AMOUNT_MISMATCH"
  | "LOCAL_PAID_RAZORPAY_DISAGREES"
  | "LOCAL_PENDING_RAZORPAY_PAID"
  | "RAZORPAY_ORDER_NOT_FOUND"
  | "PAYMENT_WITHOUT_LOCAL_ORDER";

export interface ReconciliationFinding {
  readonly kind: FindingKind;
  readonly orderNumber?: string;
  readonly razorpayOrderId?: string;
  readonly razorpayPaymentId?: string;
  readonly detail: string;
}

export interface LocalOrderLike {
  readonly orderNumber: string;
  readonly status: string;
  readonly totalAmountPaise: number;
}

export interface RazorpayOrderLike {
  readonly status: string;
  readonly amount_paid: number;
}

/**
 * The forward check: does Razorpay agree with what we think happened to this
 * order, for the same amount?
 */
export function compareOrderToRazorpay(
  order: LocalOrderLike,
  rzpOrderId: string,
  rzpOrder: RazorpayOrderLike,
): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];
  const localPaidLike = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"].includes(order.status);

  if (rzpOrder.status === "paid" && rzpOrder.amount_paid !== order.totalAmountPaise) {
    findings.push({
      kind: "AMOUNT_MISMATCH",
      orderNumber: order.orderNumber,
      razorpayOrderId: rzpOrderId,
      detail: `Local total ₹${(order.totalAmountPaise / 100).toFixed(2)} vs Razorpay amount_paid ₹${(rzpOrder.amount_paid / 100).toFixed(2)}.`,
    });
  }

  if (localPaidLike && rzpOrder.status !== "paid") {
    findings.push({
      kind: "LOCAL_PAID_RAZORPAY_DISAGREES",
      orderNumber: order.orderNumber,
      razorpayOrderId: rzpOrderId,
      detail: `Order is ${order.status} locally, but Razorpay reports order status "${rzpOrder.status}".`,
    });
  }

  if (order.status === "PENDING_PAYMENT" && rzpOrder.status === "paid") {
    findings.push({
      kind: "LOCAL_PENDING_RAZORPAY_PAID",
      orderNumber: order.orderNumber,
      razorpayOrderId: rzpOrderId,
      detail:
        "Razorpay shows this order as paid, but it's still PENDING_PAYMENT locally — likely a missed or failed webhook delivery.",
    });
  }

  return findings;
}

export interface RazorpayPaymentLike {
  readonly id: string;
  readonly status: string;
  readonly amount: number | string;
  readonly order_id?: string | null;
}

/**
 * The reverse check: does this captured payment have a matching local order?
 * Returns null for anything that isn't captured (nothing to flag) or that
 * has a match.
 */
export function checkPaymentHasLocalOrder(
  payment: RazorpayPaymentLike,
  localOrderIdsByRzpOrder: ReadonlyMap<string, LocalOrderLike>,
): ReconciliationFinding | null {
  if (payment.status !== "captured") return null;

  const matchedLocalOrder = payment.order_id ? localOrderIdsByRzpOrder.get(payment.order_id) : undefined;
  if (matchedLocalOrder) return null;

  return {
    kind: "PAYMENT_WITHOUT_LOCAL_ORDER",
    razorpayOrderId: payment.order_id ?? undefined,
    razorpayPaymentId: payment.id,
    detail: `Razorpay captured payment ${payment.id} for ₹${(Number(payment.amount) / 100).toFixed(2)}, but no local order references its order id. Investigate before assuming it's benign.`,
  };
}
