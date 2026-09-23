import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { sendOrderConfirmation } from "@/lib/email";
import { recordEvent } from "@/lib/analytics";
import { recordOrderEvent } from "@/lib/order-events";

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
 * Signature verification uses a timing-safe comparison: a plain `===` on an
 * HMAC leaks information through how long the comparison takes.
 */

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[razorpay] RAZORPAY_WEBHOOK_SECRET is not set; refusing to process.");
    return NextResponse.json({ message: "Webhook not configured." }, { status: 503 });
  }

  // The raw body is required — re-serialising parsed JSON changes the bytes
  // and the signature will never match.
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";

  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ message: "Invalid signature." }, { status: 401 });
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ message: "Malformed payload." }, { status: 400 });
  }

  const payment = event?.payload?.payment?.entity;
  const razorpayOrderId: string | undefined = payment?.order_id;
  if (!razorpayOrderId) return NextResponse.json({ received: true });

  const order = await db.order.findFirst({ where: { paymentId: razorpayOrderId } });
  if (!order) {
    console.warn("[razorpay] no local order for", razorpayOrderId);
    return NextResponse.json({ received: true });
  }

  switch (event.event) {
    case "payment.captured":
      // Idempotent: gateways retry, and a retry must not double-process.
      // The status guard also means the confirmation email is sent exactly
      // once — a retried webhook finds the order already PAID and skips both.
      if (order.status === "PENDING_PAYMENT") {
        const paid = await db.order.update({
          where: { id: order.id },
          data: { status: "PAID", paymentStatus: "captured" },
          include: { items: true },
        });

        // Confirmation is sent HERE rather than at checkout, because this is
        // the first moment the payment is actually known to have cleared.
        // Emailing "thanks for your order" off the browser redirect would
        // mean confirming orders that never got paid for.
        await recordOrderEvent(order.id, "PAYMENT_CAPTURED", { type: "SYSTEM" }, {
          razorpayPaymentId: payment.id,
          amountPaise: payment.amount,
          method: payment.method ?? null,
        });

        const sent = await sendOrderConfirmation(paid);
        await recordOrderEvent(order.id, "EMAIL_SENT", { type: "SYSTEM" }, {
          email: "order_confirmation",
          delivered: sent.delivered,
          reason: sent.reason ?? null,
        });

        if (order.sessionId) {
          void recordEvent(order.sessionId, "ORDER_PAID", {
            orderId: order.id,
            metadata: { totalPaise: payment.amount, method: "RAZORPAY" },
          });
        }
      }
      break;

    case "payment.failed":
      await db.order.update({
        where: { id: order.id },
        data: { status: "FAILED", paymentStatus: "failed" },
      });
      await recordOrderEvent(order.id, "PAYMENT_FAILED", { type: "SYSTEM" }, {
        razorpayPaymentId: payment.id,
        reason: payment.error_description ?? payment.error_reason ?? null,
      });
      // Stock is deliberately NOT returned here. A failed payment is often
      // retried within minutes, and releasing the reserved batch would let
      // someone else take the last compliant stock mid-retry. Reconciling
      // abandoned PENDING/FAILED orders belongs in a scheduled sweep.
      break;

    case "refund.processed":
      await db.order.update({
        where: { id: order.id },
        data: { status: "REFUNDED", paymentStatus: "refunded" },
      });
      await recordOrderEvent(order.id, "REFUNDED", { type: "SYSTEM" }, {
        razorpayRefundId: event?.payload?.refund?.entity?.id ?? null,
        amountPaise: event?.payload?.refund?.entity?.amount ?? null,
      });
      break;
  }

  return NextResponse.json({ received: true });
}
