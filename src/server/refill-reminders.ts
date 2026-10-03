import "server-only";
import { db } from "@/lib/db";
import { sendRefillReminderEmail } from "@/lib/email";
import { orderStatusUrl } from "@/lib/order-access";
import { enqueueMessage } from "@/server/messages";
import { isStale, refillableLines, reminderDate, runOutDate, type RefillLine } from "@/lib/refill";
import type { SendResult } from "@/lib/messages";

/**
 * Refill reminders (benchmark gap R2). A shopper asks for one on their order
 * page; when the order is delivered, the run-out date is worked out from each
 * product's pack size and daily servings (src/lib/refill.ts), and one email
 * goes a few days before. The cron job (/api/cron/messages) finds orders
 * whose reminder is due and queues it; the queue sends it and retries it.
 *
 * Opt-in only: a reminder that invites a repeat purchase isn't a pure service
 * message, so it goes only to those who asked, each request is kept as a
 * consent record (purpose REFILL_REMINDER), and every reminder can be stopped
 * with one tap.
 */

export const REFILL_PURPOSE = "REFILL_REMINDER";
export const REFILL_NOTICE = "Email me once, a few days before this runs out. Stop any time.";

/** Orders a shopper can still ask a reminder for: placed and not closed. */
const OPEN_FOR_REMINDERS = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] as const;

type Item = { productId: string; productNameSnapshot: string; quantity: number; product: { servingsPerContainer: number | null; servingsPerDay: number | null; regulatoryType: string } };

export function linesOf(items: readonly Item[]): RefillLine[] {
  return items
    .filter((i) => i.product.regulatoryType === "HEALTH_SUPPLEMENT")
    .map((i) => ({ productId: i.productId, name: i.productNameSnapshot, quantity: i.quantity, servingsPerContainer: i.product.servingsPerContainer, servingsPerDay: i.product.servingsPerDay }));
}

const ITEM_SELECT = { productId: true, productNameSnapshot: true, quantity: true, product: { select: { servingsPerContainer: true, servingsPerDay: true, regulatoryType: true } } } as const;

/** What the order page shows: whether to offer a reminder, and when it would go. */
export async function refillStatus(orderId: string): Promise<{ offer: boolean; optedIn: boolean; remindOn: Date | null; hasEmail: boolean }> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { status: true, refillOptInAt: true, guestEmail: true, deliveredAt: true, promisedDeliveryDate: true, placedAt: true, customer: { select: { email: true } }, items: { select: ITEM_SELECT } },
  });
  if (!order) return { offer: false, optedIn: false, remindOn: null, hasEmail: false };
  const lines = linesOf(order.items);
  const open = (OPEN_FOR_REMINDERS as readonly string[]).includes(order.status);
  // Before delivery, counted from the date shown at checkout.
  const from = order.deliveredAt ?? order.promisedDeliveryDate ?? new Date(order.placedAt.getTime() + 4 * 86_400_000);
  return {
    offer: open && refillableLines(lines).length > 0,
    optedIn: Boolean(order.refillOptInAt),
    remindOn: reminderDate(lines, from),
    hasEmail: Boolean(order.guestEmail ?? order.customer?.email),
  };
}

/**
 * Ask for a reminder on this order. An email given here is kept on the order
 * (email is optional at checkout). Recorded as consent, with the words shown.
 */
export async function optInRefill(orderId: string, email: string | null): Promise<void> {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { guestEmail: true, guestPhone: true, customer: { select: { email: true } } } });
  const to = order.guestEmail ?? order.customer?.email ?? email;
  await db.$transaction([
    db.order.update({ where: { id: orderId }, data: { refillOptInAt: new Date(), ...(!order.guestEmail && email ? { guestEmail: email } : {}) } }),
    db.consentRecord.create({ data: { purpose: REFILL_PURPOSE, granted: true, email: to, phone: order.guestPhone, noticeText: REFILL_NOTICE, source: "order_page", orderId } }),
  ]);
}

/**
 * Stop reminders: for this order, and every other order with the same email
 * (one tap should stop them all). Reminders already queued are cancelled.
 */
export async function stopRefill(orderId: string): Promise<void> {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { guestEmail: true, guestPhone: true } });
  const orders = await db.order.findMany({
    where: { refillOptInAt: { not: null }, OR: [{ id: orderId }, ...(order.guestEmail ? [{ guestEmail: order.guestEmail }] : [])] },
    select: { id: true },
  });
  const ids = [...new Set([orderId, ...orders.map((o) => o.id)])];
  await db.$transaction([
    db.order.updateMany({ where: { id: { in: ids } }, data: { refillOptInAt: null } }),
    db.outboundMessage.updateMany({ where: { orderId: { in: ids }, kind: "refill_reminder", status: "PENDING" }, data: { status: "CANCELLED" } }),
    db.consentRecord.create({ data: { purpose: REFILL_PURPOSE, granted: false, email: order.guestEmail, phone: order.guestPhone, noticeText: "Stopped refill reminders.", source: "stop_link", orderId } }),
  ]);
}

/**
 * Queue the reminders that have come due: delivered orders that asked for
 * one and haven't had it. Each order gets one message (keyed by order), so
 * running this every few minutes queues nothing twice. The sender makes the
 * final checks (still wanted, not stale, not already reordered).
 */
export async function queueRefillReminders(now = new Date()): Promise<number> {
  const orders = await db.order.findMany({
    where: { refillOptInAt: { not: null }, status: "DELIVERED", deliveredAt: { gte: new Date(now.getTime() - 180 * 86_400_000) }, messages: { none: { kind: "refill_reminder" } } },
    select: { id: true, deliveredAt: true, items: { select: ITEM_SELECT } },
    take: 500,
  });
  const due = orders.filter((o) => {
    const when = o.deliveredAt && reminderDate(linesOf(o.items), o.deliveredAt);
    return when && when <= now;
  });
  await enqueueMessage(db, ...due.map((o) => ({ kind: "refill_reminder" as const, dedupeKey: `refill_reminder:${o.id}`, orderId: o.id })));
  return due.length;
}

const dayLabel = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** The queue's sender for refill_reminder (src/server/message-senders.ts). */
export async function sendRefillReminder(_payload: Record<string, unknown>, orderId: string | null, now = new Date()): Promise<SendResult> {
  const order = orderId
    ? await db.order.findUnique({
        where: { id: orderId },
        select: { id: true, orderNumber: true, accessToken: true, status: true, placedAt: true, deliveredAt: true, refillOptInAt: true, guestEmail: true, guestPhone: true, customerId: true, customer: { select: { email: true } }, items: { select: ITEM_SELECT } },
      })
    : null;
  if (!order) return { delivered: false, reason: "not_found" };
  if (!order.refillOptInAt) return { delivered: false, reason: "opted_out" };
  if (order.status !== "DELIVERED" || !order.deliveredAt) return { delivered: false, reason: "not_due" };
  const lines = refillableLines(linesOf(order.items));
  if (isStale(lines, order.deliveredAt, now)) return { delivered: false, reason: "not_due" };

  // Already bought any of it again since: the reminder would only be noise.
  const buyer = [...(order.guestPhone ? [{ guestPhone: order.guestPhone }] : []), ...(order.customerId ? [{ customerId: order.customerId }] : [])];
  if (buyer.length) {
    const again = await db.order.count({
      where: { id: { not: order.id }, placedAt: { gt: order.placedAt }, status: { notIn: ["CANCELLED", "FAILED", "PENDING_PAYMENT"] }, OR: buyer, items: { some: { productId: { in: lines.map((l) => l.productId) } } } },
    });
    if (again > 0) return { delivered: false, reason: "reordered" };
  }

  const to = order.guestEmail ?? order.customer?.email;
  if (!to) return { delivered: false, reason: "no_recipient" };
  const site = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const token = order.accessToken ? `&t=${encodeURIComponent(order.accessToken)}` : "";
  return sendRefillReminderEmail(to, {
    orderNumber: order.orderNumber,
    items: lines.map((l) => l.name),
    runOutLabel: dayLabel(runOutDate(lines, order.deliveredAt)!),
    orderUrl: orderStatusUrl(order.orderNumber, order.accessToken) ?? `${site}/account`,
    stopUrl: `${site}/reminders/stop?o=${encodeURIComponent(order.orderNumber)}${token}`,
  });
}
