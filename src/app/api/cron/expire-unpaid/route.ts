import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";
import { cronAuthorized } from "@/lib/cron-auth";
import { recordOrderEvent } from "@/lib/order-events";
import { UNPAID_EXPIRY_MINUTES } from "@/lib/order-lifecycle";
import { releaseStock } from "@/server/order-stock";

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
    select: { id: true, couponCode: true, status: true },
    orderBy: { placedAt: "asc" },
    take: 100,
  });

  let closed = 0;
  for (const order of stale) {
    const changed = await db.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: order.id, status: { in: ["PENDING_PAYMENT", "FAILED"] } },
        data: { status: "CANCELLED", closeReason: "PAYMENT_NOT_COMPLETED", closedAt: new Date() },
      });
      if (count === 1) await releaseStock(tx, order);
      return count === 1;
    });
    if (!changed) continue;
    closed++;
    await recordOrderEvent(order.id, "STATUS_CHANGED", { type: "SYSTEM" }, {
      status: { from: order.status, to: "CANCELLED" },
      closeReason: { from: null, to: "PAYMENT_NOT_COMPLETED" },
    });
  }

  if (closed > 0) expireTag(CATALOG_TAG);
  return NextResponse.json({ status: "ok", checked: stale.length, closed });
}
