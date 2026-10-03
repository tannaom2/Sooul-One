import "server-only";
import { db } from "./db";
import { decimalToPaise } from "./format";
import {
  computeOrderAnalytics,
  type BrandLookupEntry,
  type OrderAnalyticsSummary,
  type OrderLike,
} from "./order-analytics-compute";

export type { OrderAnalyticsSummary } from "./order-analytics-compute";

/**
 * Order and customer analytics.
 *
 * Most orders are guest checkouts, so "customer" here means a distinct
 * mobile number (`guestPhone`, asked at every checkout and proven by code for
 * cash on delivery), not a `Customer` row. Email is optional at checkout, so
 * it's used only for older orders with no number. The same person ordering
 * from two numbers still looks like two customers: good enough for "are we
 * seeing repeat buyers," not a precise CRM number.
 *
 * "Revenue" throughout means orders in a state where money has actually
 * moved or the shopper has committed to pay on delivery — PENDING_PAYMENT and
 * FAILED are excluded because counting them would inflate revenue with money
 * that was never received.
 *
 * The actual computation lives in order-analytics-compute.ts, which is pure
 * and unit-tested; this file is just the fetching around it.
 */
export const REVENUE_STATUSES = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] as const;

export interface OrderAnalyticsReport extends OrderAnalyticsSummary {
  readonly since: Date;
  readonly until: Date;
}

export async function buildOrderAnalytics(days = 30): Promise<OrderAnalyticsReport> {
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

  const orders = await db.order.findMany({
    where: { status: { in: [...REVENUE_STATUSES] }, placedAt: { gte: since, lte: until } },
    include: { items: true },
  });

  const orderLikes: OrderLike[] = orders.map((o) => ({
    customerKey: o.guestPhone ?? o.guestEmail,
    placedAt: o.placedAt,
    totalAmountPaise: decimalToPaise(o.totalAmount),
    state: (o.shippingAddress as { state?: string } | null)?.state ?? null,
    items: o.items.map((i) => ({
      productId: i.productId,
      productNameSnapshot: i.productNameSnapshot,
      quantity: i.quantity,
      lineTotalPaise: decimalToPaise(i.lineTotal),
    })),
  }));

  // Each customer's earliest paid-like order across ALL history, not just
  // this window — a customer whose first order was last quarter and who just
  // bought again this week is a repeat buyer.
  const phones = [...new Set(orders.flatMap((o) => (o.guestPhone ? [o.guestPhone] : [])))];
  const emails = [...new Set(orders.flatMap((o) => (!o.guestPhone && o.guestEmail ? [o.guestEmail] : [])))];
  const firstOrderByCustomer = new Map<string, Date>();
  const [byPhone, byEmail] = await Promise.all([
    phones.length ? db.order.groupBy({ by: ["guestPhone"], where: { guestPhone: { in: phones }, status: { in: [...REVENUE_STATUSES] } }, _min: { placedAt: true } }) : [],
    emails.length ? db.order.groupBy({ by: ["guestEmail"], where: { guestEmail: { in: emails }, guestPhone: null, status: { in: [...REVENUE_STATUSES] } }, _min: { placedAt: true } }) : [],
  ]);
  for (const row of byPhone) if (row.guestPhone && row._min.placedAt) firstOrderByCustomer.set(row.guestPhone, row._min.placedAt);
  for (const row of byEmail) if (row.guestEmail && row._min.placedAt) firstOrderByCustomer.set(row.guestEmail, row._min.placedAt);

  const productIds = [...new Set(orderLikes.flatMap((o) => o.items.map((i) => i.productId)))];
  const productsWithBrand = productIds.length
    ? await db.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, brandId: true, brand: { select: { name: true } } },
      })
    : [];
  const brandByProduct = new Map<string, BrandLookupEntry>(
    productsWithBrand.map((p) => [p.id, { brandId: p.brandId, name: p.brand.name }]),
  );

  return {
    since,
    until,
    ...computeOrderAnalytics(orderLikes, firstOrderByCustomer, brandByProduct),
  };
}
