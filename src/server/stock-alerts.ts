import "server-only";
import { db } from "@/lib/db";
import { sendBackInStockEmail } from "@/lib/email";
import { IN_STOCK_BATCH_WHERE, isSellable } from "@/lib/basket-rules";
import { productAvailability } from "@/lib/checkout/availability";
import { SLOWEST_SERVED_ZONE, estimateDeliveryDate } from "@/lib/checkout/delivery";
import { STOCK_ALERT_DAYS, STOCK_ALERT_NOTICE, STOCK_ALERT_PURPOSE, alertLive, stockAlertKey } from "@/lib/stock-alerts";
import type { SendResult } from "@/lib/messages";
import { enqueueMessage, processMessages } from "@/server/messages";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";

/**
 * Back-in-stock alerts (benchmark gap R9; rules in src/lib/stock-alerts.ts).
 * A shopper asks on a sold-out product's page. Every few minutes, and right
 * after a batch is received, waiting requests whose product can ship again
 * are queued as one email each (src/server/messages.ts) and marked done.
 * "Can ship" is the basket's own rule: sellable, not stores-only, and stock
 * with enough shelf life left to deliver.
 */

/** Which of these products a shopper could order and have shipped right now. */
export async function shippableNow(productIds: readonly string[], now = new Date()): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const products = await db.product.findMany({
    where: { id: { in: [...productIds] } },
    include: { brand: { select: { isActive: true } }, category: { select: { isActive: true } }, batches: { where: IN_STOCK_BATCH_WHERE } },
  });
  const delivery = estimateDeliveryDate(now, SLOWEST_SERVED_ZONE);
  return new Set(
    products
      .filter((p) => isSellable(p) && !p.retailOnly)
      .filter((p) => productAvailability({ ...p, batches: p.batches.map((b) => ({ id: b.id, batchNumber: b.batchNumber, expiresOn: b.expiresOn, quantityRemaining: b.quantityRemaining })) }, delivery).shippableUnits > 0)
      .map((p) => p.id),
  );
}

export type AlertRequest = { ok: true; message: string } | { ok: false; message: string };

/**
 * Ask for an alert. Asking again for the same product and email renews the
 * request (a second wait after an earlier alert). Recorded as consent.
 */
export async function requestStockAlert(productId: string, email: string, customerId: string | null): Promise<AlertRequest> {
  const product = await db.product.findUnique({ where: { id: productId }, include: { brand: { select: { isActive: true } }, category: { select: { isActive: true } } } });
  if (!product || !isSellable(product) || product.retailOnly) return { ok: false, message: "That product isn't available." };
  if ((await shippableNow([productId])).has(productId)) return { ok: false, message: "Good news: it's back in stock now. Reload the page to order it." };
  const now = new Date();
  await db.$transaction([
    db.stockAlert.upsert({
      where: { productId_email: { productId, email } },
      create: { productId, email, customerId },
      update: { notifiedAt: null, createdAt: now, ...(customerId ? { customerId } : {}) },
    }),
    db.consentRecord.create({ data: { purpose: STOCK_ALERT_PURPOSE, granted: true, email, noticeText: STOCK_ALERT_NOTICE, source: `product:${productId}` } }),
  ]);
  return { ok: true, message: `Done. We'll email ${email} once when ${product.name} is back.` };
}

/**
 * Queue the alerts that have come due, mark them done in the same
 * transaction, and return their keys. Safe to run often: each request is
 * queued once (its key includes when it was asked).
 */
export async function queueStockAlerts(now = new Date()): Promise<string[]> {
  const waiting = await db.stockAlert.findMany({
    where: { notifiedAt: null, createdAt: { gte: new Date(now.getTime() - STOCK_ALERT_DAYS * 86_400_000) } },
    select: { id: true, productId: true, createdAt: true },
    take: 1000,
  });
  if (waiting.length === 0) return [];
  const ready = await shippableNow([...new Set(waiting.map((a) => a.productId))], now);
  const due = waiting.filter((a) => ready.has(a.productId));
  if (due.length === 0) return [];
  const messages = due.map((a) => ({ kind: "back_in_stock" as const, dedupeKey: stockAlertKey(a.id, a.createdAt), payload: { alertId: a.id } }));
  await db.$transaction(async (tx) => {
    await enqueueMessage(tx, ...messages);
    await tx.stockAlert.updateMany({ where: { id: { in: due.map((a) => a.id) }, notifiedAt: null }, data: { notifiedAt: now } });
  });
  // The email says it's back, so the page it links to must say so too: an
  // order since the stock arrived only marks the catalogue stale, which would
  // show the first visitor the old "Out of stock" (src/lib/cache-tags.ts).
  try {
    expireTag(CATALOG_TAG);
  } catch {
    // Outside a request (a script): nothing cached to clear.
  }
  return messages.map((m) => m.dedupeKey);
}

/** After a batch is received: queue and send any alerts it makes due. Never throws. */
export async function sendDueStockAlerts(): Promise<void> {
  try {
    const keys = await queueStockAlerts();
    if (keys.length) await processMessages({ dedupeKeys: keys.slice(0, 50) });
  } catch {
    // The 5-minute job picks them up.
  }
}

const dayLabel = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** The queue's sender for back_in_stock. */
export async function sendStockAlert(payload: Record<string, unknown>, now = new Date()): Promise<SendResult> {
  const alertId = typeof payload.alertId === "string" ? payload.alertId : null;
  const alert = alertId ? await db.stockAlert.findUnique({ where: { id: alertId }, include: { product: { select: { id: true, name: true, slug: true } } } }) : null;
  if (!alert) return { delivered: false, reason: "not_found" };
  if (!alertLive(alert.createdAt, now)) return { delivered: false, reason: "not_due" };
  // Sold out again before the email went: put the request back to wait.
  if (!(await shippableNow([alert.productId], now)).has(alert.productId)) {
    await db.stockAlert.update({ where: { id: alert.id }, data: { notifiedAt: null } });
    return { delivered: false, reason: "not_due" };
  }
  const site = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return sendBackInStockEmail(alert.email, { product: alert.product.name, productUrl: `${site}/product/${alert.product.slug}`, askedOn: dayLabel(alert.createdAt) });
}
