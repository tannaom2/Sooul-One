import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { CATALOG_TAG } from "@/lib/cache-tags";
import { RAIL_DAYS, RAIL_SIZE, railOrder } from "@/lib/home-rail";
import { getProductSummaries, type ProductSummary } from "@/server/catalog";

/** Orders that count as sold: paid for, or cash on delivery on its way or delivered. */
const SOLD = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] as const;

/**
 * The home page's product rail (src/lib/home-rail.ts): Featured first, then
 * the last 30 days' bestsellers by units, filled from the catalogue. Only
 * products a shopper can order right now. Cached with the catalogue, and
 * refreshed at least hourly so the ranking follows the week's orders.
 */
export const getHomeRail = unstable_cache(
  async (): Promise<ProductSummary[]> => {
    const since = new Date(Date.now() - RAIL_DAYS * 86_400_000);
    const [featured, sold, all] = await Promise.all([
      db.product.findMany({ where: { isActive: true, isFeatured: true }, orderBy: { name: "asc" }, select: { id: true } }),
      db.orderItem.groupBy({ by: ["productId"], where: { order: { status: { in: [...SOLD] }, placedAt: { gte: since } } }, _sum: { quantity: true } }),
      db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true } }),
    ]);
    // Over-fetch, then keep only what can be ordered now (not sold out, not stores-only).
    const ids = railOrder({ featured: featured.map((p) => p.id), unitsSold: new Map(sold.map((s) => [s.productId, s._sum.quantity ?? 0])), others: all.map((p) => p.id) }, RAIL_SIZE * 3);
    const summaries = await getProductSummaries(ids);
    const byId = new Map(summaries.map((s) => [s.id, s]));
    return ids
      .map((id) => byId.get(id))
      .filter((p): p is ProductSummary => Boolean(p) && !p!.retailOnly && p!.availability.state !== "out")
      .slice(0, RAIL_SIZE);
  },
  ["home-rail"],
  { revalidate: 3600, tags: [CATALOG_TAG] },
);
