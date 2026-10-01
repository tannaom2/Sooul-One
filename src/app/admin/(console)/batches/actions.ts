"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";

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
    message: `Recalled and off sale. The batch check tells shoppers not to consume it. ${orders.length} ${orders.length === 1 ? "order" : "orders"} received this batch.`,
  };
}
