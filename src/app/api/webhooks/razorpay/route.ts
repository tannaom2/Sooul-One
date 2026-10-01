import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recordOrderEvent } from "@/lib/order-events";
import { reportError } from "@/lib/observability";
import { afterPaymentCaptured, handleLateCapture } from "@/server/payments";
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

  // Razorpay's own outage notices: the fastest outage signal at low volume
  // (Analytics → Payments, and a note at checkout while one lasts).
  if (webhook.downtime) {
    const d = webhook.downtime;
    const data = { method: d.method, instrument: (d.instrument ?? undefined) as Prisma.InputJsonValue | undefined, severity: d.severity, status: d.status, beginAt: d.beginAt, endAt: d.endAt };
    // Deliveries can arrive out of order: a late "started" never reopens a resolved outage.
    const existing = await db.paymentDowntime.findUnique({ where: { id: d.id }, select: { status: true } });
    if (!existing) await db.paymentDowntime.create({ data: { id: d.id, ...data } }).catch(() => undefined);
    else if (existing.status !== "resolved") await db.paymentDowntime.update({ where: { id: d.id }, data });
    return NextResponse.json({ received: true });
  }

  const transition = paymentTransition(webhook.event);
  const payment = webhook.payment;
  if (!transition || !payment) return NextResponse.json({ received: true });

  const order = await db.order.findFirst({ where: { paymentId: payment.razorpayOrderId }, select: { id: true, sessionId: true } });

  // Every attempt, captured or failed, for payment health per method, even
  // a second failure on an order that already failed (which moves nothing
  // below). A redelivered webhook hits the unique key and records nothing new.
  if (webhook.event === "payment.captured" || webhook.event === "payment.failed") {
    await db.paymentAttempt
      .create({
        data: {
          orderId: order?.id ?? null,
          razorpayOrderId: payment.razorpayOrderId,
          razorpayPaymentId: payment.id,
          method: payment.method,
          status: webhook.event === "payment.captured" ? "CAPTURED" : "FAILED",
          errorSource: payment.errorSource,
          errorCode: payment.errorCode,
          errorReason: payment.errorReason?.slice(0, 300) ?? null,
          amountPaise: payment.amountPaise,
        },
      })
      .catch((error: unknown) => {
        if ((error as { code?: string } | null)?.code !== "P2002") reportError("webhook/payment-attempt", error, { orderId: order?.id });
      });
  }

  if (!order) {
    console.warn("[razorpay] no local order for", payment.razorpayOrderId);
    return NextResponse.json({ received: true });
  }

  const { count } = await db.order.updateMany({
    where: { id: order.id, status: { in: [...transition.from] } },
    data: { status: transition.to, paymentStatus: transition.paymentStatus },
  });
  // Already moved by an earlier delivery, or not allowed from where the order
  // is now (a late failure for a paid order): nothing more to do. Except a
  // capture for an order the unpaid sweep already closed: the shopper paid,
  // so the order is put back or the payment refunded (src/server/payments.ts).
  if (count === 0) {
    if (webhook.event === "payment.captured") {
      const outcome = await handleLateCapture(order.id, payment);
      if (outcome !== "ignored") console.warn(`[razorpay] late capture on ${order.id}: ${outcome}`);
    }
    return NextResponse.json({ received: true });
  }

  switch (webhook.event) {
    case "payment.captured":
      // The timeline, basket, confirmation email and funnel event, shared with
      // the sweep and late-payment paths so all three behave the same.
      await afterPaymentCaptured(order, payment, "webhook");
      break;

    case "payment.failed":
      // The shopper may still retry in the same window; a later capture moves
      // the order to PAID (see paymentTransition). Stock stays reserved so a
      // retry can't lose the last compliant batch mid-payment.
      await recordOrderEvent(order.id, "PAYMENT_FAILED", { type: "SYSTEM" }, {
        razorpayPaymentId: payment.id,
        reason: payment.errorReason,
        method: payment.method,
        source: payment.errorSource,
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
