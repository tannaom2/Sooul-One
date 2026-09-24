import "server-only";
import { db } from "@/lib/db";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

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
