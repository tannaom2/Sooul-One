import "server-only";
import { db } from "@/lib/db";
import { decimalToPaise } from "@/lib/format";
import { asAddress, type StoredAddress } from "@/lib/stored-order";
import type { PackLine } from "@/lib/packing";

/** How many waiting orders the packing screen lists at once. */
export const PACKING_QUEUE_SIZE = 40;

export interface QueueOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly placedAt: Date;
  readonly cod: boolean;
  readonly totalPaise: number;
  readonly address: StoredAddress;
  readonly lines: PackLine[];
}

/** Orders waiting to be packed (paid, or already being packed), oldest first, or exactly these ids. */
export async function packingQueue(ids?: readonly string[]): Promise<QueueOrder[]> {
  const orders = await db.order.findMany({
    where: ids ? { id: { in: [...ids] }, status: { in: ["PAID", "PROCESSING"] } } : { status: { in: ["PAID", "PROCESSING"] } },
    orderBy: { placedAt: "asc" },
    take: ids ? 100 : PACKING_QUEUE_SIZE,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      placedAt: true,
      paymentGateway: true,
      totalAmount: true,
      shippingAddress: true,
      items: { select: { productId: true, productNameSnapshot: true, quantity: true, batch: { select: { batchNumber: true } } } },
    },
  });
  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    placedAt: o.placedAt,
    cod: o.paymentGateway === "COD",
    totalPaise: decimalToPaise(o.totalAmount),
    address: asAddress(o.shippingAddress),
    lines: o.items.map((i) => ({ productId: i.productId, name: i.productNameSnapshot, quantity: i.quantity, batchNumber: i.batch?.batchNumber ?? null })),
  }));
}
