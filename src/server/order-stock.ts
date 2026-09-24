import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/*
 * Batches are the only stock record. Product."stockQuantity" is a derived
 * total that a database trigger keeps equal to the sum of the product's
 * batches (migration 20260926050000_stock_from_batches), so these functions
 * touch batches only and never the product count.
 */

export interface BatchTake {
  readonly id: string;
  readonly qty: number;
  /** Product name, to tell the shopper which item just sold out. */
  readonly name: string;
}

/**
 * Take an order's stock in one statement, however many lines and batches it
 * has. Every decrement applies only where enough remains; returns the name of
 * the first item that fell short, or null. The caller throws on a shortfall,
 * which rolls the whole order back, including any decrements this made.
 */
export async function takeStock(tx: Tx, batches: readonly BatchTake[]): Promise<string | null> {
  if (batches.length === 0) return null;
  const values = Prisma.join(batches.map((b) => Prisma.sql`(${b.id}::text, ${b.qty}::int)`));
  const taken = await tx.$queryRaw<{ id: string }[]>`
    WITH bt(id, qty) AS (VALUES ${values})
    UPDATE "ProductBatch" pb SET "quantityRemaining" = pb."quantityRemaining" - bt.qty
    FROM bt WHERE pb.id = bt.id AND pb."quantityRemaining" >= bt.qty
    RETURNING pb.id`;
  const took = new Set(taken.map((t) => t.id));
  return batches.find((b) => !took.has(b.id))?.name ?? null;
}

/**
 * Put a cancelled order's stock back on sale and give back its coupon use:
 * the exact inverse of what create-order took. Runs inside the caller's
 * transaction, alongside the status change, so the two can't come apart.
 * Each order item records the batch it came from, so the stock returns to
 * the same batch and keeps its best-before date.
 */
export async function releaseStock(tx: Tx, order: { id: string; couponCode: string | null }): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId: order.id, batchId: { not: null } },
    select: { batchId: true, quantity: true },
  });
  for (const item of items) {
    await tx.productBatch.update({
      where: { id: item.batchId! },
      data: { quantityRemaining: { increment: item.quantity } },
    });
  }

  if (order.couponCode) {
    await tx.coupon.updateMany({
      where: { code: order.couponCode, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  }
}
