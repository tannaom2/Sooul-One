import "server-only";
import { db } from "@/lib/db";
import { sendCheckInEmail, sendDeliveredEmail, sendRefundEmail, sendReviewRequestEmail } from "@/lib/email";
import { orderStatusUrl } from "@/lib/order-access";
import { CHECK_IN_DAYS, FOLLOW_UP_PURPOSE, REVIEW_REQUEST_DAYS, canReviewFrom, followUpKey, howToTake, morningIST, reviewableItems } from "@/lib/follow-ups";
import type { SendResult } from "@/lib/messages";
import type { NewMessage } from "@/server/messages";
import { refillStatus } from "@/server/refill-reminders";

/**
 * Sending the emails after an order (benchmark gap R5; rules in
 * src/lib/follow-ups.ts). All of them go through the message queue
 * (src/server/messages.ts): the delivered note at once, the check-in and the
 * review request scheduled for later. Each sender re-checks when it runs, so
 * an order that came back, a shopper who said stop, or products already
 * reviewed mean nothing goes.
 */

const site = () => (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** The three messages a delivery queues (inside the status change's transaction). */
export function followUpsOnDelivery(orderId: string, deliveredAt: Date): NewMessage[] {
  return [
    { kind: "delivered_notice", dedupeKey: followUpKey.delivered(orderId), orderId },
    { kind: "check_in", dedupeKey: followUpKey.checkIn(orderId), orderId, sendAfter: morningIST(deliveredAt, CHECK_IN_DAYS) },
    { kind: "review_request", dedupeKey: followUpKey.reviewRequest(orderId), orderId, sendAfter: morningIST(deliveredAt, REVIEW_REQUEST_DAYS) },
  ];
}

/** Whether this shopper stopped follow-ups: their latest choice, by email or phone, across orders. */
export async function followUpsStopped(email: string | null, phone: string | null): Promise<boolean> {
  const who = [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])];
  if (who.length === 0) return false;
  const latest = await db.consentRecord.findFirst({ where: { purpose: FOLLOW_UP_PURPOSE, OR: who }, orderBy: { createdAt: "desc" }, select: { granted: true } });
  return latest ? !latest.granted : false;
}

/** Stop check-ins and review requests for this shopper, and cancel the ones already scheduled. */
export async function stopFollowUps(orderId: string): Promise<void> {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { guestEmail: true, guestPhone: true } });
  const same = [{ id: orderId }, ...(order.guestEmail ? [{ guestEmail: order.guestEmail }] : []), ...(order.guestPhone ? [{ guestPhone: order.guestPhone }] : [])];
  await db.$transaction([
    db.outboundMessage.updateMany({ where: { kind: { in: ["check_in", "review_request"] }, status: "PENDING", order: { OR: same } }, data: { status: "CANCELLED" } }),
    db.consentRecord.create({
      data: { purpose: FOLLOW_UP_PURPOSE, granted: false, email: order.guestEmail, phone: order.guestPhone, noticeText: "Stopped check-in and review request emails.", source: "stop_link", orderId },
    }),
  ]);
}

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  accessToken: true,
  status: true,
  guestEmail: true,
  guestPhone: true,
  customer: { select: { email: true } },
  items: { select: { productId: true, productNameSnapshot: true, product: { select: { regulatoryType: true, dosageGuidance: true } } } },
} as const;

async function loadOrder(orderId: string | null) {
  return orderId ? db.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT }) : null;
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;

const recipient = (o: Loaded) => o.guestEmail ?? o.customer?.email ?? null;

/** The order page link, which also proves it's theirs to the stop page and the review form. */
const stopUrl = (o: Loaded) => `${site()}/reminders/stop?k=follow-ups&o=${encodeURIComponent(o.orderNumber)}${o.accessToken ? `&t=${encodeURIComponent(o.accessToken)}` : ""}`;

/** Sender for delivered_notice: a service message, so a stopped follow-up doesn't stop it. */
export async function sendDeliveredNotice(orderId: string | null): Promise<SendResult> {
  const order = await loadOrder(orderId);
  if (!order) return { delivered: false, reason: "not_found" };
  if (order.status !== "DELIVERED") return { delivered: false, reason: "not_due" };
  const to = recipient(order);
  if (!to) return { delivered: false, reason: "no_recipient" };
  const refill = await refillStatus(order.id);
  return sendDeliveredEmail(to, {
    orderNumber: order.orderNumber,
    orderUrl: orderStatusUrl(order.orderNumber, order.accessToken),
    usage: howToTake(order.items),
    offerRefill: refill.offer && !refill.optedIn,
  });
}

/** Sender for check_in. */
export async function sendCheckIn(orderId: string | null): Promise<SendResult> {
  const order = await loadOrder(orderId);
  if (!order) return { delivered: false, reason: "not_found" };
  if (order.status !== "DELIVERED") return { delivered: false, reason: "not_due" };
  const to = recipient(order);
  if (!to) return { delivered: false, reason: "no_recipient" };
  if (await followUpsStopped(order.guestEmail ?? to, order.guestPhone)) return { delivered: false, reason: "opted_out" };
  return sendCheckInEmail(to, { orderNumber: order.orderNumber, orderUrl: orderStatusUrl(order.orderNumber, order.accessToken), usage: howToTake(order.items), stopUrl: stopUrl(order) });
}

/** Sender for review_request: only for products not yet reviewed from this order. */
export async function sendReviewRequest(orderId: string | null): Promise<SendResult> {
  const order = await loadOrder(orderId);
  if (!order) return { delivered: false, reason: "not_found" };
  if (!canReviewFrom(order.status)) return { delivered: false, reason: "not_due" };
  const to = recipient(order);
  if (!to) return { delivered: false, reason: "no_recipient" };
  const orderUrl = orderStatusUrl(order.orderNumber, order.accessToken);
  if (!orderUrl) return { delivered: false, reason: "not_found" }; // no private link to review from
  if (await followUpsStopped(order.guestEmail ?? to, order.guestPhone)) return { delivered: false, reason: "opted_out" };
  const reviewed = await db.review.findMany({ where: { orderId: order.id }, select: { productId: true } });
  const left = reviewableItems(order.items, reviewed.map((r) => r.productId));
  if (left.length === 0) return { delivered: false, reason: "not_due" };
  return sendReviewRequestEmail(to, { orderNumber: order.orderNumber, reviewUrl: `${orderUrl}#review`, products: left.map((i) => i.productNameSnapshot), stopUrl: stopUrl(order) });
}

/** Sender for refund_notice. */
export async function sendRefundNotice(payload: Record<string, unknown>, orderId: string | null): Promise<SendResult> {
  const order = await loadOrder(orderId);
  if (!order) return { delivered: false, reason: "not_found" };
  const to = recipient(order);
  if (!to) return { delivered: false, reason: "no_recipient" };
  const amountPaise = typeof payload.amountPaise === "number" ? payload.amountPaise : null;
  return sendRefundEmail(to, { orderNumber: order.orderNumber, amountPaise, orderUrl: orderStatusUrl(order.orderNumber, order.accessToken) });
}
