import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendOrderConfirmation } from "@/lib/email";
import { recordEvent } from "@/lib/analytics";
import { recordOrderEvent } from "@/lib/order-events";
import { clearCart } from "@/server/cart";
import { reportError } from "@/lib/observability";
import { parseRazorpayWebhook, paymentTransition, verifyRazorpaySignature } from "@/lib/payment-webhook";

/**
 * Razorpay webhook.
 *
 * WHY THE WEBHOOK IS THE SOURCE OF TRUTH
 * The browser redirect after payment is a convenience, not evidence. It can be
 * forged, it can be closed before it fires, and it can arrive before the
 * gateway has actually settled. Marking an order PAID on the strength of a
 * client callback is how people end up shipping against payments that never
 * completed. Only this endpoint, with a verified signature, changes status.
 *
 * Which status each event may move, and from what, is decided in
 * src/lib/payment-webhook.ts (tested there). Here it's applied as a single
 * conditional update: gateways retry and can deliver twice at once, and only
 * the delivery whose update actually changed the row goes on to email the
 * customer and empty the basket.
 */

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[razorpay] RAZORPAY_WEBHOOK_SECRET is not set; refusing to process.");
    return NextResponse.json({ message: "Webhook not configured." }, { status: 503 });
  }

  // The raw body is required: the signature covers its exact bytes.
  const raw = await request.text();
  if (!verifyRazorpaySignature(raw, request.headers.get("x-razorpay-signature"), secret)) {
    return NextResponse.json({ message: "Invalid signature." }, { status: 401 });
  }

  const webhook = parseRazorpayWebhook(raw);
  if (!webhook) return NextResponse.json({ message: "Malformed payload." }, { status: 400 });

  const transition = paymentTransition(webhook.event);
  const payment = webhook.payment;
  if (!transition || !payment) return NextResponse.json({ received: true });

  const order = await db.order.findFirst({ where: { paymentId: payment.razorpayOrderId }, select: { id: true, sessionId: true } });
  if (!order) {
    console.warn("[razorpay] no local order for", payment.razorpayOrderId);
    return NextResponse.json({ received: true });
  }

  const { count } = await db.order.updateMany({
    where: { id: order.id, status: { in: [...transition.from] } },
    data: { status: transition.to, paymentStatus: transition.paymentStatus },
  });
  // Already moved by an earlier delivery, or not allowed from where the order
  // is now (a late failure for a paid order): nothing more to do.
  if (count === 0) return NextResponse.json({ received: true });

  switch (webhook.event) {
    case "payment.captured": {
      await recordOrderEvent(order.id, "PAYMENT_CAPTURED", { type: "SYSTEM" }, {
        razorpayPaymentId: payment.id,
        amountPaise: payment.amountPaise,
        method: payment.method,
      });

      // Paid, so the basket it came from empties. Never fails the webhook:
      // Razorpay would retry, and the order is already correctly PAID.
      if (order.sessionId) {
        await clearCart(order.sessionId).catch((error) => reportError("webhook/clear-cart", error, { orderId: order.id }));
      }

      // Sent here, not at checkout: this is the first moment the payment is
      // known to have cleared.
      const paid = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
      const sent = await sendOrderConfirmation(paid);
      await recordOrderEvent(order.id, "EMAIL_SENT", { type: "SYSTEM" }, {
        email: "order_confirmation",
        delivered: sent.delivered,
        reason: sent.reason ?? null,
      });

      if (order.sessionId) {
        void recordEvent(order.sessionId, "ORDER_PAID", {
          orderId: order.id,
          metadata: { totalPaise: payment.amountPaise, method: "RAZORPAY" },
        });
      }
      break;
    }

    case "payment.failed":
      // The shopper may still retry in the same window; a later capture moves
      // the order to PAID (see paymentTransition). Stock stays reserved so a
      // retry can't lose the last compliant batch mid-payment.
      await recordOrderEvent(order.id, "PAYMENT_FAILED", { type: "SYSTEM" }, {
        razorpayPaymentId: payment.id,
        reason: payment.errorReason,
      });
      break;

    case "refund.processed":
      await recordOrderEvent(order.id, "REFUNDED", { type: "SYSTEM" }, {
        razorpayRefundId: webhook.refund?.id ?? null,
        amountPaise: webhook.refund?.amountPaise ?? null,
      });
      break;
  }

  return NextResponse.json({ received: true });
}
