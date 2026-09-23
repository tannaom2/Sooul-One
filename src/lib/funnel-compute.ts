/**
 * Pure computation for funnel and abandonment reporting.
 *
 * No "server-only" import and no Prisma calls — kept separate from funnel.ts
 * (which does both) so this file can be imported by Vitest at all. Same
 * pattern as reconciliation-compare.ts relative to reconciliation.ts.
 */

export const STAGES = ["VISIT", "PRODUCT_VIEW", "ADD_TO_CART", "CHECKOUT_STARTED", "ORDER_PAID"] as const;
export type FunnelStageType = (typeof STAGES)[number];

const STAGE_LABEL: Record<FunnelStageType, string> = {
  VISIT: "Visited the site",
  PRODUCT_VIEW: "Viewed a product",
  ADD_TO_CART: "Added to basket",
  CHECKOUT_STARTED: "Started checkout",
  ORDER_PAID: "Completed an order",
};

export interface FunnelStage {
  readonly type: FunnelStageType;
  readonly label: string;
  readonly sessions: number;
  /** Of the stage before this one. Null for the first stage, or when the previous stage is empty. */
  readonly conversionFromPrevious: number | null;
  /** Of the very first stage (VISIT). Null when there were no visits to divide by. */
  readonly conversionFromStart: number | null;
}

/**
 * `counts` must be distinct-session counts per stage, in `STAGES` order — a
 * shopper who views the same product three times is one funnel entrant, not
 * three, and counting rows instead of distinct sessions would understate
 * every drop-off rate below whichever stage people tend to repeat. That
 * distinct-counting happens in funnel.ts's database query; this function only
 * turns the resulting numbers into stages and conversion rates.
 */
export function computeFunnelStages(counts: readonly number[]): FunnelStage[] {
  // A rate over an empty base isn't 0% or 200% — it's undefined, and showing
  // a number there is how the funnel once reported "200% of visitors".
  const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);
  const start = counts[0] ?? 0;

  return STAGES.map((type, i) => ({
    type,
    label: STAGE_LABEL[type],
    sessions: counts[i] ?? 0,
    conversionFromPrevious: i === 0 ? null : rate(counts[i] ?? 0, counts[i - 1] ?? 0),
    conversionFromStart: rate(counts[i] ?? 0, start),
  }));
}

export interface AbandonedCartRow {
  readonly sessionId: string;
  readonly lastAddedAt: Date;
  readonly productNames: readonly string[];
}

export interface AddToCartEventLike {
  readonly sessionId: string;
  readonly productId: string | null;
  readonly createdAt: Date;
}

/**
 * A session that added to cart but never reached CHECKOUT_STARTED. Sessions
 * that started checkout are excluded even if they didn't pay — that's
 * checkout abandonment, a different (and generally more actionable) problem
 * than never reaching checkout at all, and conflating the two would hide
 * which one is actually happening.
 */
export function groupAbandonedCarts(
  addedToCart: readonly AddToCartEventLike[],
  startedSessions: ReadonlySet<string>,
  nameById: ReadonlyMap<string, string>,
  limit = 50,
): AbandonedCartRow[] {
  const bySession = new Map<string, { lastAddedAt: Date; productIds: Set<string> }>();
  for (const row of addedToCart) {
    if (startedSessions.has(row.sessionId)) continue;
    const existing = bySession.get(row.sessionId);
    if (existing) {
      existing.productIds.add(row.productId ?? "");
      if (row.createdAt > existing.lastAddedAt) existing.lastAddedAt = row.createdAt;
    } else {
      bySession.set(row.sessionId, { lastAddedAt: row.createdAt, productIds: new Set([row.productId ?? ""]) });
    }
  }

  return [...bySession.entries()]
    .sort((a, b) => b[1].lastAddedAt.getTime() - a[1].lastAddedAt.getTime())
    .slice(0, limit)
    .map(([sessionId, v]) => ({
      sessionId,
      lastAddedAt: v.lastAddedAt,
      productNames: [...v.productIds].map((id) => nameById.get(id) ?? "Unknown product"),
    }));
}
