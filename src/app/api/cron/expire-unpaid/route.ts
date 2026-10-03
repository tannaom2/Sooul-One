import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { onOrderStatusChanged } from "@/server/referrals";
import { CATALOG_TAG, refreshTag } from "@/lib/cache-tags";
import { cronAuthorized } from "@/lib/cron-auth";
import { recordOrderEvent } from "@/lib/order-events";
import { UNPAID_EXPIRY_MINUTES } from "@/lib/order-lifecycle";
import { releaseStock } from "@/server/order-stock";
import { sweepDecision } from "@/lib/payment-webhook";
import { fetchOrderPayments, markPaidFromSweep, razorpayClient } from "@/server/payments";

/**
 * Close online orders that were never paid, and return their stock.
 *
 * create-order reserves batch stock and a coupon use before the shopper pays,
 * so a closed payment window would otherwise hold that stock forever and show
 * the product as sold out. Run every 10 minutes by a Render cron job
 * (render.yaml); anything unpaid for UNPAID_EXPIRY_MINUTES is cancelled.
 *
 * Each order is claimed with a conditional update, so a payment that lands
 * mid-sweep wins: the webhook moves the order to PAID first and this skips it.
 *
 * Before closing an online order it asks Razorpay (launch defect D2): a
 * webhook can be late or lost, and cancelling a paid order resells its stock
 * while the shopper's money is taken. Captured there: marked paid here.
 * Authorized: left for the next run. Razorpay unreachable: left too, never
 * read as "unpaid". Without Razorpay keys no online payment can exist, so
 * those orders close as before.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ status: "not_configured", reason: "CRON_SECRET unset" }, { status: 503 });
  }
  if (!cronAuthorized(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - UNPAID_EXPIRY_MINUTES * 60_000);
  const stale = await db.order.findMany({
    where: { status: { in: ["PENDING_PAYMENT", "FAILED"] }, placedAt: { lt: cutoff } },
    select: { id: true, couponCode: true, status: true, paymentGateway: true, paymentId: true, sessionId: true },
    orderBy: { placedAt: "asc" },
    take: 100,
  });

  let closed = 0;
  let paid = 0;
  let waiting = 0;
  const askRazorpay = razorpayClient() !== null;
  for (const order of stale) {
    if (askRazorpay && order.paymentGateway === "RAZORPAY" && order.paymentId) {
      const payments = await fetchOrderPayments(order.paymentId);
      if (payments === null) {
        waiting++;
        continue;
      }
      const decision = sweepDecision(payments);
      if (decision === "paid") {
        const captured = payments.find((p) => p.status === "captured")!;
        if (await markPaidFromSweep(order, { id: captured.id, amountPaise: captured.amount, method: captured.method })) paid++;
        continue;
      }
      if (decision === "wait") {
        waiting++;
        continue;
      }
    }
    const changed = await db.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: order.id, status: { in: ["PENDING_PAYMENT", "FAILED"] } },
        data: { status: "CANCELLED", closeReason: "PAYMENT_NOT_COMPLETED", closedAt: new Date() },
      });
      if (count === 1) {
        await releaseStock(tx, order);
        await onOrderStatusChanged(tx, order.id, "CANCELLED", "SYSTEM");
      }
      return count === 1;
    });
    if (!changed) continue;
    closed++;
    await recordOrderEvent(order.id, "STATUS_CHANGED", { type: "SYSTEM" }, {
      status: { from: order.status, to: "CANCELLED" },
      closeReason: { from: null, to: "PAYMENT_NOT_COMPLETED" },
    });
  }

  if (closed > 0) refreshTag(CATALOG_TAG); // stock returned: see src/lib/cache-tags.ts
  return NextResponse.json({ status: "ok", checked: stale.length, closed, paid, waiting });
}
