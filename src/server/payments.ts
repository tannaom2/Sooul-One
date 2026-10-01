import "server-only";
import { after } from "next/server";
import Razorpay from "razorpay";
import { db } from "@/lib/db";
import { sendOrderConfirmation } from "@/lib/email";
import { recordEvent } from "@/lib/analytics";
import { recordOrderEvent } from "@/lib/order-events";
import { reportError } from "@/lib/observability";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";
import { lateCaptureAction } from "@/lib/payment-webhook";
import { clearCart } from "@/server/cart";
import { takeStock } from "@/server/order-stock";
import { alertOwnerNewOrder } from "@/server/order-alert";

/**
 * What happens once a payment is known to be captured, wherever that's
 * learned: the Razorpay webhook, the unpaid-order sweep asking Razorpay, or
 * a capture that arrives after the sweep closed the order (launch defect D2).
 */

export interface CapturedPayment {
  readonly id: string | null;
  readonly amountPaise: number | null;
  readonly method: string | null;
}

export function razorpayClient(): Razorpay | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  return keyId && keySecret ? new Razorpay({ key_id: keyId, key_secret: keySecret }) : null;
}

/**
 * Razorpay's own list of payments against one of its orders, or null when it
 * can't be asked (no keys, or the call failed). Null must never be read as
 * "nothing was paid".
 */
export async function fetchOrderPayments(razorpayOrderId: string): Promise<{ id: string; status: string; amount: number; method: string | null }[] | null> {
  const razorpay = razorpayClient();
  if (!razorpay) return null;
  try {
    const result = (await razorpay.orders.fetchPayments(razorpayOrderId)) as { items?: { id: string; status: string; amount: number | string; method?: string }[] };
    return (result.items ?? []).map((p) => ({ id: p.id, status: p.status, amount: Number(p.amount), method: p.method ?? null }));
  } catch (error) {
    reportError("payments/fetch", error, { razorpayOrderId });
    return null;
  }
}

/**
 * The paid order's follow-ups, run once by whichever path moved it to PAID:
 * the timeline entry, emptying the basket it came from, the confirmation
 * email and the funnel event. None of them may fail the caller.
 */
export async function afterPaymentCaptured(order: { id: string; sessionId: string | null }, payment: CapturedPayment, via: "webhook" | "sweep" | "late"): Promise<void> {
  await recordOrderEvent(order.id, "PAYMENT_CAPTURED", { type: "SYSTEM" }, {
    razorpayPaymentId: payment.id,
    amountPaise: payment.amountPaise,
    method: payment.method,
    ...(via !== "webhook" && { via }),
  });
  if (order.sessionId) {
    await clearCart(order.sessionId).catch((error) => reportError("payments/clear-cart", error, { orderId: order.id }));
  }
  // The first moment the payment is known to have cleared.
  const paid = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  const sent = await sendOrderConfirmation(paid);
  await recordOrderEvent(order.id, "EMAIL_SENT", { type: "SYSTEM" }, { email: "order_confirmation", delivered: sent.delivered, reason: sent.reason ?? null });
  // The owner hears about an online order once it's paid (M9).
  await alertOwnerNewOrder(order.id);
  if (order.sessionId) {
    const sessionId = order.sessionId;
    after(() => recordEvent(sessionId, "ORDER_PAID", { orderId: order.id, metadata: { totalPaise: payment.amountPaise, method: "RAZORPAY" } }));
  }
}

/** An unpaid order the sweep found paid at Razorpay: marked paid exactly as the webhook would. */
export async function markPaidFromSweep(order: { id: string; sessionId: string | null }, payment: CapturedPayment): Promise<boolean> {
  const { count } = await db.order.updateMany({
    where: { id: order.id, status: { in: ["PENDING_PAYMENT", "FAILED"] } },
    data: { status: "PAID", paymentStatus: "captured" },
  });
  if (count === 0) return false; // the webhook got there first
  await afterPaymentCaptured(order, payment, "sweep");
  return true;
}

class StockGone extends Error {}

/**
 * A capture for an order the sweep already cancelled. Put the order back if
 * its stock can still be taken and nothing else was unwound when it closed;
 * otherwise refund the payment in full. Returns what was done.
 */
export async function handleLateCapture(orderId: string, payment: CapturedPayment): Promise<"reinstated" | "refunded" | "refund-failed" | "ignored"> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, closeReason: true, couponCode: true, sessionId: true, items: { select: { batchId: true, quantity: true, productNameSnapshot: true } } },
  });
  if (!order) return "ignored";
  const [usedWallet, referral] = await Promise.all([
    db.walletEntry.findFirst({ where: { orderId, kind: "ORDER_REDEMPTION" }, select: { id: true } }),
    db.referral.findUnique({ where: { qualifyingOrderId: orderId }, select: { id: true } }),
  ]);
  const action = lateCaptureAction({ status: order.status, closeReason: order.closeReason, usedWallet: Boolean(usedWallet), hasReferral: Boolean(referral) });
  if (action === "ignore") return "ignored";

  if (action === "reinstate") {
    try {
      const reinstated = await db.$transaction(async (tx) => {
        const { count } = await tx.order.updateMany({
          where: { id: orderId, status: "CANCELLED", closeReason: "PAYMENT_NOT_COMPLETED" },
          data: { status: "PAID", paymentStatus: "captured", closeReason: null, closedAt: null },
        });
        if (count === 0) return false;
        // Take back exactly what the sweep released; any shortfall (sold, or recalled since) rolls this back.
        const takes = order.items.filter((i) => i.batchId).map((i) => ({ id: i.batchId!, qty: i.quantity, name: i.productNameSnapshot }));
        if (await takeStock(tx, takes)) throw new StockGone();
        if (order.couponCode) await tx.coupon.updateMany({ where: { code: order.couponCode }, data: { usedCount: { increment: 1 } } });
        return true;
      });
      if (reinstated) {
        expireTag(CATALOG_TAG);
        await recordOrderEvent(orderId, "STATUS_CHANGED", { type: "SYSTEM" }, {
          status: { from: "CANCELLED", to: "PAID" },
          closeReason: { from: "PAYMENT_NOT_COMPLETED", to: null },
          note: "Payment arrived after the order had expired; its stock was still available, so the order was put back.",
        });
        await afterPaymentCaptured(order, payment, "late");
        return "reinstated";
      }
      return "ignored";
    } catch (error) {
      if (!(error instanceof StockGone)) throw error;
      // Fall through to the refund.
    }
  }

  return refundLatePayment(orderId, payment);
}

async function refundLatePayment(orderId: string, payment: CapturedPayment): Promise<"refunded" | "refund-failed"> {
  const razorpay = razorpayClient();
  const note = "Payment arrived after the order had expired and couldn't be put back, so it was refunded in full.";
  if (razorpay && payment.id) {
    try {
      await razorpay.payments.refund(payment.id, { ...(payment.amountPaise ? { amount: payment.amountPaise } : {}), notes: { reason: "late_payment_on_expired_order", orderId } });
      await db.order.update({ where: { id: orderId }, data: { paymentStatus: "refund_requested" } });
      // refund.processed then moves the order to REFUNDED (src/lib/payment-webhook.ts).
      await recordOrderEvent(orderId, "NOTE", { type: "SYSTEM" }, { note, razorpayPaymentId: payment.id, amountPaise: payment.amountPaise });
      return "refunded";
    } catch (error) {
      reportError("payments/late-refund", error, { orderId, razorpayPaymentId: payment.id });
    }
  }
  // Couldn't refund automatically: flag it loudly for a person.
  await db.order.update({ where: { id: orderId }, data: { paymentStatus: "captured_after_cancel" } });
  await recordOrderEvent(orderId, "NOTE", { type: "SYSTEM" }, {
    note: "Payment arrived after the order had expired, and the automatic refund failed. Refund it from the Razorpay dashboard.",
    razorpayPaymentId: payment.id,
    amountPaise: payment.amountPaise,
  });
  reportError("payments/late-capture-unrefunded", new Error("Late capture needs a manual refund"), { orderId, razorpayPaymentId: payment.id });
  return "refund-failed";
}
