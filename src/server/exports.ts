import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decimalToPaise } from "@/lib/format";
import { buildInvoice } from "@/lib/invoice";
import type { GstTreatment } from "@/lib/money";
import { asAddress } from "@/lib/stored-order";
import type { InvoicedOrder, OrderExportRow, StockExportRow } from "@/lib/exports";

/**
 * Data for the console's downloads (src/lib/exports.ts builds the files).
 * Callers check permissions and the authenticator step first.
 */

/** A big month is a few thousand orders; past this, narrow the dates. */
export const EXPORT_ROW_LIMIT = 10_000;

const paiseOrNull = (v: Prisma.Decimal | null | undefined) => (v == null ? null : decimalToPaise(v));

/** Orders placed in [from, to), or exactly these ids (ticked on the orders list). */
export async function ordersForExport(scope: { from: Date; to: Date } | { ids: readonly string[] }): Promise<OrderExportRow[]> {
  const where: Prisma.OrderWhereInput = "ids" in scope ? { id: { in: [...scope.ids] } } : { placedAt: { gte: scope.from, lt: scope.to } };
  const orders = await db.order.findMany({
    where,
    orderBy: { placedAt: "asc" },
    take: EXPORT_ROW_LIMIT,
    include: { _count: { select: { items: true } } },
  });
  return orders.map((o) => {
    const address = asAddress(o.shippingAddress);
    return {
      orderNumber: o.orderNumber,
      placedAt: o.placedAt,
      status: o.status,
      paymentGateway: o.paymentGateway,
      paymentStatus: o.paymentStatus,
      items: o._count.items,
      subtotalPaise: decimalToPaise(o.subtotal),
      discountPaise: decimalToPaise(o.bundleDiscountAmount) + decimalToPaise(o.discountAmount) + decimalToPaise(o.creditAmount),
      shippingPaise: decimalToPaise(o.shippingAmount),
      totalPaise: decimalToPaise(o.totalAmount),
      name: address.name ?? null,
      phone: o.guestPhone,
      email: o.guestEmail,
      city: address.city ?? null,
      pincode: address.postalCode ?? o.postalCode ?? null,
      courier: o.courierPartner,
      tracking: o.trackingNumber,
      invoiceNumber: o.invoiceNumber,
      closeReason: o.closeReason,
    };
  });
}

/** Every invoice dated in [from, to), with its lines worked out exactly as the printed invoice does. */
export async function invoicesForExport(from: Date, to: Date): Promise<InvoicedOrder[]> {
  const orders = await db.order.findMany({
    where: { invoiceNumber: { not: null }, invoiceDate: { gte: from, lt: to } },
    orderBy: { invoiceDate: "asc" },
    take: EXPORT_ROW_LIMIT,
    include: { items: { include: { product: { select: { hsnCode: true, taxRatePercent: true } } } } },
  });
  return orders.map((o) => {
    const address = asAddress(o.shippingAddress);
    return {
      invoiceNumber: o.invoiceNumber!,
      invoiceDate: o.invoiceDate ?? o.placedAt,
      orderNumber: o.orderNumber,
      buyerName: address.name ?? null,
      placeOfSupply: address.state ?? null,
      status: o.status,
      invoice: buildInvoice({
        gstTreatment: (o.gstTreatment as GstTreatment | null) ?? null,
        shippingPaise: decimalToPaise(o.shippingAmount),
        shippingTaxPaise: paiseOrNull(o.shippingTaxAmount),
        totalPaise: decimalToPaise(o.totalAmount),
        items: o.items.map((i) => ({
          productId: i.productId,
          productNameSnapshot: i.productNameSnapshot,
          hsnCode: i.hsnCode ?? i.product?.hsnCode ?? null,
          taxRatePercent: i.taxRatePercent != null ? Number(i.taxRatePercent) : i.product?.taxRatePercent != null ? Number(i.product.taxRatePercent) : null,
          quantity: i.quantity,
          lineTotalPaise: decimalToPaise(i.lineTotal),
          taxablePaise: paiseOrNull(i.taxableAmount),
          taxPaise: paiseOrNull(i.taxAmount),
        })),
      }),
    };
  });
}

/** Every batch still holding stock, or every batch with `all`, soonest best-before first. */
export async function stockForExport(all: boolean): Promise<StockExportRow[]> {
  const batches = await db.productBatch.findMany({
    where: all ? {} : { quantityRemaining: { gt: 0 } },
    orderBy: [{ expiresOn: "asc" }],
    take: EXPORT_ROW_LIMIT,
    include: { product: { select: { name: true, brand: { select: { name: true } } } }, supplier: { select: { name: true } } },
  });
  return batches.map((b) => ({
    product: b.product.name,
    brand: b.product.brand?.name ?? "",
    batchNumber: b.batchNumber,
    supplier: b.supplier?.name ?? null,
    receivedOn: b.receivedOn,
    manufacturedOn: b.manufacturedOn,
    expiresOn: b.expiresOn,
    quantityReceived: b.quantityReceived,
    quantityRemaining: b.quantityRemaining,
    recalled: b.recalledAt !== null,
  }));
}
