import "server-only";
import Razorpay from "razorpay";
import { db } from "./db";
import { decimalToPaise } from "./format";
import {
  compareOrderToRazorpay,
  checkPaymentHasLocalOrder,
  type LocalOrderLike,
  type ReconciliationFinding,
} from "./reconciliation-compare";

export type { FindingKind, ReconciliationFinding } from "./reconciliation-compare";

/**
 * Payment reconciliation: does what we believe happened actually match what
 * Razorpay's own records say happened.
 *
 * WHY THIS EXISTS
 * The webhook (src/app/api/webhooks/razorpay/route.ts) is the only thing that
 * ever marks an order PAID, and it verifies a signature before doing so — so
 * a payment cannot be silently redirected to somebody else's account, and a
 * forged browser callback cannot fake a paid order. That closes the obvious
 * attack. This module answers a different, quieter question: is our copy of
 * "what happened" still in agreement with Razorpay's, given things like a
 * webhook delivery that failed and was never retried, a manual refund done
 * from the Razorpay dashboard that our webhook config doesn't cover, or a
 * bug introduced later that this suite would catch before a customer does.
 *
 * TWO DIRECTIONS, BOTH NEEDED
 *   Forward: for every local RAZORPAY order, does Razorpay agree it was paid,
 *   for the same amount? Catches an order stuck PENDING_PAYMENT that
 *   actually cleared (missed webhook), or one we show as PAID that Razorpay
 *   has no matching record for.
 *
 *   Reverse: for every payment Razorpay actually captured in the window, does
 *   a local order exist for it at all? This is the direction that would catch
 *   a payment landing against this Razorpay account with no corresponding
 *   local order — the exact "did the money actually reach us" question this
 *   was built to answer. In practice that can only happen from a bug (an
 *   order row failing to save after the Razorpay order was created) rather
 *   than external redirection, since both the order and the payment are tied
 *   to the same Razorpay account by construction — but that is a conclusion
 *   this check earns by looking, not one asserted without it.
 *
 * The comparison logic itself lives in reconciliation-compare.ts, which is
 * pure and unit-tested; this file is just the fetching and pagination around it.
 */

export interface ReconciliationResult {
  readonly ranAt: Date;
  readonly windowDays: number;
  readonly localOrdersChecked: number;
  readonly razorpayPaymentsChecked: number;
  readonly findings: readonly ReconciliationFinding[];
}

function client(): Razorpay | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/**
 * Local orders are keyed by `paymentId`, which stores the Razorpay ORDER id
 * (see create-order/route.ts) — not a payment id. An order can have more than
 * one payment attempt (retries after a failure), so the forward check
 * compares against the order, and the reverse check separately looks up which
 * local order each individual payment belongs to via the same field.
 */
export async function reconcilePayments(windowDays = 30): Promise<ReconciliationResult> {
  const razorpay = client();
  const findings: ReconciliationFinding[] = [];
  const ranAt = new Date();
  const since = new Date(ranAt.getTime() - windowDays * 24 * 60 * 60 * 1000);

  if (!razorpay) {
    return {
      ranAt,
      windowDays,
      localOrdersChecked: 0,
      razorpayPaymentsChecked: 0,
      findings: [
        {
          kind: "RAZORPAY_ORDER_NOT_FOUND",
          detail: "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured — cannot reconcile.",
        },
      ],
    };
  }

  const localOrders = await db.order.findMany({
    where: {
      paymentGateway: "RAZORPAY",
      paymentId: { not: null },
      placedAt: { gte: since },
    },
    orderBy: { placedAt: "desc" },
  });

  // --- Forward: does Razorpay agree with what we think happened? ----------
  for (const order of localOrders) {
    const rzpOrderId = order.paymentId!;
    try {
      const rzpOrder = await razorpay.orders.fetch(rzpOrderId);
      findings.push(
        ...compareOrderToRazorpay(
          { orderNumber: order.orderNumber, status: order.status, totalAmountPaise: decimalToPaise(order.totalAmount) },
          rzpOrderId,
          rzpOrder,
        ),
      );
    } catch {
      findings.push({
        kind: "RAZORPAY_ORDER_NOT_FOUND",
        orderNumber: order.orderNumber,
        razorpayOrderId: rzpOrderId,
        detail: "Razorpay has no order with this id — check for a data-entry or environment mismatch.",
      });
    }
  }

  // --- Reverse: does every captured payment have a local order? -----------
  const localOrderIdsByRzpOrder = new Map<string, LocalOrderLike>(
    localOrders.map((o) => [
      o.paymentId!,
      { orderNumber: o.orderNumber, status: o.status, totalAmountPaise: decimalToPaise(o.totalAmount) },
    ]),
  );
  let razorpayPaymentsChecked = 0;
  let skip = 0;
  const pageSize = 100;

  for (;;) {
    const page = await razorpay.payments.all({
      from: Math.floor(since.getTime() / 1000),
      to: Math.floor(ranAt.getTime() / 1000),
      count: pageSize,
      skip,
    });

    for (const payment of page.items) {
      if (payment.status !== "captured") continue;
      razorpayPaymentsChecked += 1;

      const finding = checkPaymentHasLocalOrder(payment, localOrderIdsByRzpOrder);
      if (finding) findings.push(finding);
    }

    if (page.items.length < pageSize) break;
    skip += pageSize;
    if (skip > 2_000) break; // sane cap for an on-demand admin check
  }

  return {
    ranAt,
    windowDays,
    localOrdersChecked: localOrders.length,
    razorpayPaymentsChecked,
    findings,
  };
}
