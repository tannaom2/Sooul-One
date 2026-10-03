"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";
import { sendRecallNotices } from "@/server/recall";

/**
 * Mark a batch recalled (with a note shoppers see on /verify), or lift the
 * recall. A recalled batch is off sale at once: it leaves the stock total,
 * availability, the basket and checkout (SELLABLE_BATCH_WHERE), and the
 * order's stock take refuses it. The batch check tells anyone holding a pack
 * not to consume it. Orders that received it are traceable from OrderItem.batchId.
 */
export async function setBatchRecall(batchId: string, recalled: boolean, note: string): Promise<{ ok: boolean; message: string }> {
  const session = await requirePermission("batches:write");
  if (!session) return { ok: false, message: "Your role can't change batches." };
  const trimmed = note.trim().slice(0, 300) || null;
  const batch = await db.productBatch.findUnique({ where: { id: batchId }, select: { batchNumber: true, recalledAt: true, product: { select: { name: true } } } });
  if (!batch) return { ok: false, message: "That batch no longer exists." };
  await db.productBatch.update({ where: { id: batchId }, data: recalled ? { recalledAt: batch.recalledAt ?? new Date(), recallNote: trimmed } : { recalledAt: null, recallNote: null } });
  await audit(session, recalled ? "RECALL_BATCH" : "LIFT_BATCH_RECALL", "ProductBatch", batchId, { product: batch.product.name, batch: batch.batchNumber, note: trimmed });
  expireTag(CATALOG_TAG);
  revalidatePath("/admin/batches");
  if (!recalled) return { ok: true, message: "Recall lifted. The batch is back on sale." };
  const orders = await db.orderItem.findMany({ where: { batchId }, select: { orderId: true }, distinct: ["orderId"] });
  return {
    ok: true,
    message: `Recalled and off sale. The batch check tells shoppers not to consume it. ${orders.length} ${orders.length === 1 ? "order" : "orders"} received this batch: see who, and tell them, under "Who received it".`,
  };
}

/**
 * Email the recall notice to every buyer who has the goods (src/server/recall.ts).
 * Owner only. Each buyer gets one email per recall, however often this is pressed.
 */
export async function sendRecallNoticesAction(batchId: string, notice: string): Promise<{ ok: boolean; message: string }> {
  const session = await requirePermission("recalls:notify");
  if (!session) return { ok: false, message: "Only the owner can email a recall notice." };
  const text = notice.trim();
  if (text.length < 40) return { ok: false, message: "Write the notice first: what's recalled, what to do, and how to get a refund." };
  if (text.length > 3000) return { ok: false, message: "Keep the notice under 3,000 characters." };
  const result = await sendRecallNotices(batchId, text);
  if (!result.ok) return result;
  await audit(session, "SEND_RECALL_NOTICES", "ProductBatch", batchId, { emailed: result.queued, toCall: result.call });
  revalidatePath(`/admin/batches/${batchId}`);
  return {
    ok: true,
    message: `${result.queued === 0 ? "Every buyer with an email already has this notice; nothing new sent." : `Sending to ${result.queued} ${result.queued === 1 ? "buyer" : "buyers"}; each shows on its order's timeline.`}${result.call ? ` ${result.call} without an email need a call (listed below).` : ""}`,
  };
}
