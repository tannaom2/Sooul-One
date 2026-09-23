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
 * There is no account system yet (README: "Customer accounts... not
 * launch-blocking... not yet built") — every order is a guest checkout, so
 * "customer" here means a distinct `guestEmail`, not a `Customer` row. That's
 * a real limitation worth stating plainly: the same person checking out with
 * two different email addresses looks like two customers, and there is no
 * way to know otherwise without an account system. Good enough for "are we
 * seeing repeat buyers at all," not a precise CRM number.
 *
 * "Revenue" throughout means orders in a state where money has actually
 * moved or the shopper has committed to pay on delivery — PENDING_PAYMENT and
 * FAILED are excluded because counting them would inflate revenue with money
 * that was never received.
 *
 * The actual computation lives in order-analytics-compute.ts, which is pure
 * and unit-tested; this file is just the fetching around it.
 */
const REVENUE_STATUSES = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] as const;

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
    guestEmail: o.guestEmail,
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

  // Each email's earliest paid-like order across ALL history, not just this
  // window — a customer whose first order was last quarter and who just
  // bought again this week is a repeat buyer.
  const emails = [...new Set(orderLikes.map((o) => o.guestEmail).filter((e): e is string => Boolean(e)))];
  const firstOrderByEmail = new Map<string, Date>();
  if (emails.length) {
    const earliest = await db.order.groupBy({
      by: ["guestEmail"],
      where: { guestEmail: { in: emails }, status: { in: [...REVENUE_STATUSES] } },
      _min: { placedAt: true },
    });
    for (const row of earliest) {
      if (row.guestEmail && row._min.placedAt) firstOrderByEmail.set(row.guestEmail, row._min.placedAt);
    }
  }

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
    ...computeOrderAnalytics(orderLikes, firstOrderByEmail, brandByProduct),
  };
}
