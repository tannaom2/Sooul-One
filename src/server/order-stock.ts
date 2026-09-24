import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export interface BatchTake {
  readonly id: string;
  readonly qty: number;
  /** Product name, to tell the shopper which item just sold out. */
  readonly name: string;
}

export interface ProductTake extends BatchTake {
  /** True when this count is the stock record (not batch-tracked) and must not go below zero. */
  readonly guarded: boolean;
}

/**
 * Take an order's stock in one statement, however many lines and batches it
 * has: one round trip instead of one or two per line. Every batch decrement
 * applies only where enough remains (as does the product count for untracked
 * products); returns the name of the first item that fell short, or null.
 * The caller throws on a shortfall, which rolls the whole order back,
 * including any decrements this statement did make.
 */
export async function takeStock(tx: Tx, batches: readonly BatchTake[], products: readonly ProductTake[]): Promise<string | null> {
  const batchValues = batches.length
    ? Prisma.sql`VALUES ${Prisma.join(batches.map((b) => Prisma.sql`(${b.id}::text, ${b.qty}::int)`))}`
    : Prisma.sql`SELECT NULL::text, 0 WHERE false`;
  const productValues = products.length
    ? Prisma.sql`VALUES ${Prisma.join(products.map((p) => Prisma.sql`(${p.id}::text, ${p.qty}::int, ${p.guarded}::boolean)`))}`
    : Prisma.sql`SELECT NULL::text, 0, false WHERE false`;

  const taken = await tx.$queryRaw<{ kind: "batch" | "product"; id: string }[]>`
    WITH bt(id, qty) AS (${batchValues}),
         pt(id, qty, guarded) AS (${productValues}),
         b AS (
           UPDATE "ProductBatch" pb SET "quantityRemaining" = pb."quantityRemaining" - bt.qty
           FROM bt WHERE pb.id = bt.id AND pb."quantityRemaining" >= bt.qty
           RETURNING pb.id
         ),
         p AS (
           UPDATE "Product" pr SET "stockQuantity" = pr."stockQuantity" - pt.qty, "updatedAt" = now()
           FROM pt WHERE pr.id = pt.id AND (NOT pt.guarded OR pr."stockQuantity" >= pt.qty)
           RETURNING pr.id
         )
    SELECT 'batch' AS kind, id FROM b UNION ALL SELECT 'product' AS kind, id FROM p`;

  const took = new Set(taken.map((t) => `${t.kind}:${t.id}`));
  const shortBatch = batches.find((b) => !took.has(`batch:${b.id}`));
  if (shortBatch) return shortBatch.name;
  const shortProduct = products.find((p) => !took.has(`product:${p.id}`));
  return shortProduct?.name ?? null;
}

/**
 * Put a cancelled order's stock back on sale and give back its coupon use:
 * the exact inverse of what create-order took. Runs inside the caller's
 * transaction, alongside the status change, so the two can't come apart.
 *
 * Each order item records the batch it was drawn from (null when the product
 * isn't batch-tracked), so the stock returns to the same batch and keeps its
 * best-before date.
 */
export async function releaseStock(tx: Tx, order: { id: string; couponCode: string | null }): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId: order.id },
    select: { productId: true, batchId: true, quantity: true },
  });

  for (const item of items) {
    if (item.batchId) {
      await tx.productBatch.update({
        where: { id: item.batchId },
        data: { quantityRemaining: { increment: item.quantity } },
      });
    }
    await tx.product.update({
      where: { id: item.productId },
      data: { stockQuantity: { increment: item.quantity } },
    });
  }

  if (order.couponCode) {
    await tx.coupon.updateMany({
      where: { code: order.couponCode, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  }
}
