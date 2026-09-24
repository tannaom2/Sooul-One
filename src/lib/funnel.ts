import "server-only";
import { db } from "./db";
import {
  STAGES,
  computeFunnelStages,
  groupAbandonedCarts,
  type FunnelStage,
  type FunnelStageType,
} from "./funnel-compute";
import { INTERACTION_TYPES, summariseInteractions } from "./interactions";

export type { FunnelStage, FunnelStageType, AbandonedCartRow } from "./funnel-compute";

/**
 * Funnel and cart-abandonment reporting — the database fetching around the
 * pure computation in funnel-compute.ts (which is what's unit-tested).
 */

export interface FunnelReport {
  readonly since: Date;
  readonly until: Date;
  readonly stages: readonly FunnelStage[];
}

export async function buildFunnel(days = 30): Promise<FunnelReport> {
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

  // Distinct sessions per stage — a shopper who views the same product three
  // times is one funnel entrant, not three.
  const counts = await Promise.all(
    STAGES.map((type) =>
      db.analyticsEvent
        .findMany({
          where: { type, createdAt: { gte: since, lte: until } },
          select: { sessionId: true },
          distinct: ["sessionId"],
        })
        .then((rows) => rows.length),
    ),
  );

  return { since, until, stages: computeFunnelStages(counts) };
}

export async function findAbandonedCarts(days = 7, limit = 50) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [addedToCart, startedCheckout] = await Promise.all([
    db.analyticsEvent.findMany({
      where: { type: "ADD_TO_CART", createdAt: { gte: since } },
      select: { sessionId: true, productId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    db.analyticsEvent.findMany({
      where: { type: "CHECKOUT_STARTED", createdAt: { gte: since } },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
  ]);

  const startedSessions = new Set(startedCheckout.map((r) => r.sessionId));

  const productIds = [...new Set(addedToCart.map((r) => r.productId).filter((id): id is string => Boolean(id)))];
  const products = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } });
  const nameById = new Map(products.map((p) => [p.id, p.name]));

  return groupAbandonedCarts(addedToCart, startedSessions, nameById, limit);
}

/**
 * Storefront interactions in the window, for the Funnel page. Capped so a
 * busy month can't turn an admin page view into an unbounded read; at the cap
 * the page says the figures are partial.
 */
export async function buildInteractions(days = 30, cap = 20_000) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.analyticsEvent.findMany({
    where: { type: { in: [...INTERACTION_TYPES] }, createdAt: { gte: since } },
    select: { sessionId: true, type: true, metadata: true },
    orderBy: { createdAt: "desc" },
    take: cap,
  });
  return { lines: summariseInteractions(rows), partial: rows.length >= cap };
}
