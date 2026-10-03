import "server-only";
import { db } from "@/lib/db";
import { sendRecallNoticeEmail } from "@/lib/email";
import { recipients, type RecipientRow } from "@/lib/recall";
import type { SendResult } from "@/lib/messages";
import { enqueueMessage, processMessages } from "@/server/messages";
import { getBusinessProfile } from "@/server/business";

/**
 * A batch's recall: who received it (src/lib/recall.ts) and the notice to
 * its buyers, sent through the message queue so each one is recorded on the
 * order's timeline and retried if it fails.
 */

export async function loadRecall(batchId: string) {
  const batch = await db.productBatch.findUnique({
    where: { id: batchId },
    include: {
      product: { select: { id: true, name: true, manufacturer: { select: { name: true, fssaiLicence: true } } } },
      supplier: { select: { name: true, fssaiLicence: true } },
      orderItems: {
        select: {
          quantity: true,
          order: {
            select: { id: true, orderNumber: true, placedAt: true, status: true, guestPhone: true, guestEmail: true, postalCode: true, shippingAddress: true, customer: { select: { email: true } } },
          },
        },
      },
    },
  });
  if (!batch) return null;
  return { batch, rows: recipients(batch.orderItems) };
}

export const recallKey = (batchId: string, orderId: string) => `recall_notice:${batchId}:${orderId}`;

/** Who gets the notice: buyers with the goods, and an email to send to. The rest are called. */
export function noticeTargets(rows: readonly RecipientRow[]) {
  const withGoods = rows.filter((r) => r.group === "customer");
  return { email: withGoods.filter((r) => r.email), call: withGoods.filter((r) => !r.email) };
}

/**
 * Email every buyer who has the goods. The notice text is kept on the batch;
 * each buyer gets one email per recall (keyed by batch and order), however
 * many times this is pressed.
 */
export async function sendRecallNotices(batchId: string, notice: string): Promise<{ ok: true; queued: number; call: number } | { ok: false; message: string }> {
  const loaded = await loadRecall(batchId);
  if (!loaded) return { ok: false, message: "That batch no longer exists." };
  if (!loaded.batch.recalledAt) return { ok: false, message: "Recall the batch first: notices only go for a recalled batch." };
  const { email, call } = noticeTargets(loaded.rows);
  await db.productBatch.update({ where: { id: batchId }, data: { recallNoticeText: notice, recallNotifiedAt: new Date() } });
  const messages = email.map((r) => ({ kind: "recall_notice" as const, dedupeKey: recallKey(batchId, r.orderId), orderId: r.orderId, payload: { batchId } }));
  // Buyers already sent this recall's notice are skipped by their key.
  const queued = await enqueueMessage(db, ...messages);
  // The first few go straight away; the 5-minute job sends the rest.
  await processMessages({ dedupeKeys: messages.slice(0, 20).map((m) => m.dedupeKey) });
  return { ok: true, queued, call: call.length };
}

/** The queue's sender for recall_notice (src/server/message-senders.ts). */
export async function sendRecallNotice(payload: Record<string, unknown>, orderId: string | null): Promise<SendResult> {
  const batchId = typeof payload.batchId === "string" ? payload.batchId : null;
  const [batch, order] = await Promise.all([
    batchId ? db.productBatch.findUnique({ where: { id: batchId }, select: { batchNumber: true, recalledAt: true, recallNoticeText: true, product: { select: { name: true } } } }) : null,
    orderId ? db.order.findUnique({ where: { id: orderId }, select: { orderNumber: true, guestEmail: true, customer: { select: { email: true } } } }) : null,
  ]);
  if (!batch || !order) return { delivered: false, reason: "not_found" };
  // Lifted since it was queued: nothing to tell them.
  if (!batch.recalledAt || !batch.recallNoticeText) return { delivered: false, reason: "not_due" };
  const to = order.guestEmail ?? order.customer?.email;
  if (!to) return { delivered: false, reason: "no_recipient" };
  const business = await getBusinessProfile();
  return sendRecallNoticeEmail(to, {
    product: batch.product.name,
    batchNumber: batch.batchNumber,
    orderNumber: order.orderNumber,
    notice: batch.recallNoticeText,
    contact: [business.customerCarePhone, business.customerCareEmail].filter(Boolean).join(" · ") || null,
  });
}
