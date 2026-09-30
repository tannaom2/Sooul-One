"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";

/**
 * Mark a batch recalled (with a note shoppers see on /verify), or lift the
 * recall. The batch check then tells anyone holding a pack from it not to
 * consume it. Orders that received the batch are traceable from OrderItem.batchId.
 */
export async function setBatchRecall(batchId: string, recalled: boolean, note: string): Promise<{ ok: boolean; message: string }> {
  const session = await requirePermission("batches:write");
  if (!session) return { ok: false, message: "Your role can't change batches." };
  const trimmed = note.trim().slice(0, 300) || null;
  const batch = await db.productBatch.findUnique({ where: { id: batchId }, select: { batchNumber: true, recalledAt: true, product: { select: { name: true } } } });
  if (!batch) return { ok: false, message: "That batch no longer exists." };
  await db.productBatch.update({ where: { id: batchId }, data: recalled ? { recalledAt: batch.recalledAt ?? new Date(), recallNote: trimmed } : { recalledAt: null, recallNote: null } });
  await audit(session, recalled ? "RECALL_BATCH" : "LIFT_BATCH_RECALL", "ProductBatch", batchId, { product: batch.product.name, batch: batch.batchNumber, note: trimmed });
  revalidatePath("/admin/batches");
  return { ok: true, message: recalled ? "Recalled. The batch check now tells shoppers not to consume it." : "Recall lifted." };
}
