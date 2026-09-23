/**
 * Pure computation for order and customer analytics.
 *
 * No "server-only" import and no Prisma calls — kept separate from
 * order-analytics.ts (which does both) so this file can be imported by
 * Vitest at all. Same pattern as reconciliation-compare.ts and
 * funnel-compute.ts relative to their respective orchestration files.
 */

export interface OrderItemLike {
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly quantity: number;
  readonly lineTotalPaise: number;
}

export interface OrderLike {
  readonly guestEmail: string | null;
  readonly placedAt: Date;
  readonly totalAmountPaise: number;
  readonly state: string | null;
  readonly items: readonly OrderItemLike[];
}

export interface BrandLookupEntry {
  readonly brandId: string;
  readonly name: string;
}

export interface OrderAnalyticsSummary {
  readonly orderCount: number;
  readonly revenuePaise: number;
  readonly averageOrderValuePaise: number;
  readonly newCustomerOrders: number;
  readonly repeatCustomerOrders: number;
  readonly distinctCustomers: number;
  readonly topProducts: readonly { productId: string; name: string; quantity: number; revenuePaise: number }[];
  readonly topBrands: readonly { brandId: string; name: string; revenuePaise: number }[];
  readonly revenueByState: readonly { state: string; revenuePaise: number; orderCount: number }[];
}

/**
 * `firstOrderByEmail` must be each email's earliest paid-like order across
 * ALL history, not just the current window — a customer whose first-ever
 * order was last quarter and who just bought again this week is a repeat
 * buyer, and building that map is the one thing this function can't do
 * itself since it only sees orders in the current window.
 */
export function computeOrderAnalytics(
  orders: readonly OrderLike[],
  firstOrderByEmail: ReadonlyMap<string, Date>,
  brandByProduct: ReadonlyMap<string, BrandLookupEntry>,
): OrderAnalyticsSummary {
  const revenuePaise = orders.reduce((sum, o) => sum + o.totalAmountPaise, 0);
  const averageOrderValuePaise = orders.length ? Math.round(revenuePaise / orders.length) : 0;

  const emails = [...new Set(orders.map((o) => o.guestEmail).filter((e): e is string => Boolean(e)))];

  let newCustomerOrders = 0;
  let repeatCustomerOrders = 0;
  for (const order of orders) {
    if (!order.guestEmail) continue;
    const firstEver = firstOrderByEmail.get(order.guestEmail);
    const isFirstOrder = firstEver && firstEver.getTime() === order.placedAt.getTime();
    if (isFirstOrder) newCustomerOrders += 1;
    else repeatCustomerOrders += 1;
  }

  // --- Best-selling products / brands ---------------------------------------
  const productTotals = new Map<string, { name: string; quantity: number; revenuePaise: number }>();
  for (const order of orders) {
    for (const item of order.items) {
      const existing = productTotals.get(item.productId) ?? {
        name: item.productNameSnapshot,
        quantity: 0,
        revenuePaise: 0,
      };
      existing.quantity += item.quantity;
      existing.revenuePaise += item.lineTotalPaise;
      productTotals.set(item.productId, existing);
    }
  }
  const topProducts = [...productTotals.entries()]
    .map(([productId, v]) => ({ productId, ...v }))
    .sort((a, b) => b.revenuePaise - a.revenuePaise)
    .slice(0, 10);

  const brandTotals = new Map<string, { name: string; revenuePaise: number }>();
  for (const [productId, totals] of productTotals) {
    const brand = brandByProduct.get(productId);
    if (!brand) continue;
    const existing = brandTotals.get(brand.brandId) ?? { name: brand.name, revenuePaise: 0 };
    existing.revenuePaise += totals.revenuePaise;
    brandTotals.set(brand.brandId, existing);
  }
  const topBrands = [...brandTotals.entries()]
    .map(([brandId, v]) => ({ brandId, ...v }))
    .sort((a, b) => b.revenuePaise - a.revenuePaise)
    .slice(0, 10);

  // --- Revenue by state -------------------------------------------------------
  const stateTotals = new Map<string, { revenuePaise: number; orderCount: number }>();
  for (const order of orders) {
    const state = order.state?.trim() || "Unknown";
    const existing = stateTotals.get(state) ?? { revenuePaise: 0, orderCount: 0 };
    existing.revenuePaise += order.totalAmountPaise;
    existing.orderCount += 1;
    stateTotals.set(state, existing);
  }
  const revenueByState = [...stateTotals.entries()]
    .map(([state, v]) => ({ state, ...v }))
    .sort((a, b) => b.revenuePaise - a.revenuePaise);

  return {
    orderCount: orders.length,
    revenuePaise,
    averageOrderValuePaise,
    newCustomerOrders,
    repeatCustomerOrders,
    distinctCustomers: emails.length,
    topProducts,
    topBrands,
    revenueByState,
  };
}
