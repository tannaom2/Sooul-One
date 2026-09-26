/**
 * Invariants the demo dataset must satisfy, checked in SQL against what was
 * actually written. Each returns rows only when something is wrong.
 */
import type { PrismaClient } from "@prisma/client";

const CHECKS: { name: string; sql: string }[] = [
  {
    name: "order item rows add up to the order subtotal",
    sql: `select o."orderNumber" from "Order" o join "OrderItem" i on i."orderId" = o.id
          group by o.id having sum(i."lineTotal") <> o.subtotal`,
  },
  {
    name: "order total = subtotal − bundle − coupon + delivery",
    sql: `select "orderNumber" from "Order"
          where "totalAmount" <> subtotal - "bundleDiscountAmount" - "discountAmount" + "shippingAmount"`,
  },
  {
    name: "tax on item rows plus delivery tax = order tax",
    sql: `select o."orderNumber" from "Order" o join "OrderItem" i on i."orderId" = o.id
          group by o.id having sum(i."taxAmount") + coalesce(o."shippingTaxAmount", 0) <> o."taxAmount"`,
  },
  {
    name: "invoice numbers run 1..N with no gaps or duplicates",
    sql: `with n as (select split_part("invoiceNumber", '/', 3)::int as k from "Order" where "invoiceNumber" is not null)
          select 'gap' from n having count(*) <> max(k) or count(distinct k) <> count(*)`,
  },
  {
    name: "invoice sequence matches the last invoice issued",
    sql: `select s."financialYear" from "InvoiceSequence" s
          where s."lastNumber" <> (select count(*) from "Order" where "invoiceNumber" like 'SO/' || substr(s."financialYear", 3) || '/%')`,
  },
  {
    name: "only shipped orders have invoices",
    sql: `select "orderNumber" from "Order" where ("invoiceNumber" is not null) <> (status in ('SHIPPED','DELIVERED','RTO','RETURNED'))`,
  },
  {
    name: "each item's batch belongs to its product",
    sql: `select i.id from "OrderItem" i join "ProductBatch" b on b.id = i."batchId" where b."productId" <> i."productId"`,
  },
  {
    name: "product stock equals the sum of its batches",
    sql: `select p.sku from "Product" p left join "ProductBatch" b on b."productId" = p.id
          group by p.id having p."stockQuantity" <> coalesce(sum(b."quantityRemaining"), 0)`,
  },
  {
    name: "no batch has negative stock or more than it received",
    sql: `select "batchNumber" from "ProductBatch" where "quantityRemaining" < 0 or "quantityRemaining" > "quantityReceived"`,
  },
  {
    name: "nothing is dated in the future",
    sql: `select 'order' from "Order" where "placedAt" > now() + interval '1 minute'
          union all select 'event' from "OrderEvent" where "createdAt" > now() + interval '1 minute'
          union all select 'review' from "Review" where "createdAt" > now() + interval '1 minute'
          union all select 'analytics' from "AnalyticsEvent" where "createdAt" > now() + interval '1 minute'`,
  },
  {
    name: "delivered orders were delivered after they shipped",
    sql: `select "orderNumber" from "Order" where status = 'DELIVERED' and ("deliveredAt" is null or "deliveredAt" < "invoiceDate")`,
  },
  {
    name: "closed orders carry a close reason",
    sql: `select "orderNumber" from "Order" where status in ('CANCELLED','RTO','RETURNED') and ("closeReason" is null or "closedAt" is null)`,
  },
  {
    name: "coupon use counts match orders that kept the coupon",
    sql: `select c.code from "Coupon" c where c."usedCount" <>
          (select count(*) from "Order" o where o."couponCode" = c.code and o.status not in ('CANCELLED','FAILED'))`,
  },
];

export async function verifyDemo(db: PrismaClient): Promise<string[]> {
  const problems: string[] = [];
  for (const check of CHECKS) {
    const rows = await db.$queryRawUnsafe<unknown[]>(check.sql);
    if (rows.length) problems.push(`${check.name} (${rows.length} failing)`);
  }
  return problems;
}
