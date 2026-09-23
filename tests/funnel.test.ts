import { describe, expect, it } from "vitest";
import { computeFunnelStages, groupAbandonedCarts, type AddToCartEventLike } from "../src/lib/funnel-compute";

describe("computeFunnelStages", () => {
  it("computes conversion from previous stage and from the start", () => {
    const stages = computeFunnelStages([1000, 400, 200, 100, 40]);

    expect(stages[0].conversionFromPrevious).toBeNull();
    expect(stages[0].conversionFromStart).toBe(1);

    expect(stages[1].sessions).toBe(400);
    expect(stages[1].conversionFromPrevious).toBeCloseTo(0.4);
    expect(stages[1].conversionFromStart).toBeCloseTo(0.4);

    expect(stages[4].sessions).toBe(40);
    expect(stages[4].conversionFromPrevious).toBeCloseTo(0.4);
    expect(stages[4].conversionFromStart).toBeCloseTo(0.04);
  });

  it("does not divide by zero when there is no traffic at all", () => {
    const stages = computeFunnelStages([0, 0, 0, 0, 0]);
    expect(stages.every((s) => Number.isFinite(s.conversionFromStart))).toBe(true);
    expect(stages[0].conversionFromStart).toBe(0);
  });

  it("reports zero conversion into a stage that had visitors before it but none reached it", () => {
    const stages = computeFunnelStages([100, 0, 0, 0, 0]);
    expect(stages[1].conversionFromPrevious).toBe(0);
  });

  it("handles a stage recovering after a zero previous stage without dividing by zero", () => {
    // Pathological (a later stage can't exceed an earlier one in practice),
    // but the arithmetic must not produce Infinity/NaN regardless.
    const stages = computeFunnelStages([0, 5, 0, 0, 0]);
    expect(stages[1].conversionFromPrevious).toBe(0);
    expect(Number.isFinite(stages[1].conversionFromStart)).toBe(true);
  });
});

describe("groupAbandonedCarts", () => {
  const event = (over: Partial<AddToCartEventLike> = {}): AddToCartEventLike => ({
    sessionId: "s1",
    productId: "p1",
    createdAt: new Date("2026-09-01T10:00:00Z"),
    ...over,
  });

  it("excludes sessions that started checkout, even if they added to cart", () => {
    const rows = groupAbandonedCarts([event({ sessionId: "s1" })], new Set(["s1"]), new Map(), 50);
    expect(rows).toEqual([]);
  });

  it("includes a session that added to cart and never started checkout", () => {
    const rows = groupAbandonedCarts(
      [event({ sessionId: "s1", productId: "p1" })],
      new Set(),
      new Map([["p1", "Gummy Bears"]]),
      50,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].productNames).toEqual(["Gummy Bears"]);
  });

  it("merges multiple add-to-cart events from the same session into one row", () => {
    const rows = groupAbandonedCarts(
      [
        event({ sessionId: "s1", productId: "p1", createdAt: new Date("2026-09-01T10:00:00Z") }),
        event({ sessionId: "s1", productId: "p2", createdAt: new Date("2026-09-01T12:00:00Z") }),
      ],
      new Set(),
      new Map([
        ["p1", "Product One"],
        ["p2", "Product Two"],
      ]),
      50,
    );
    expect(rows).toHaveLength(1);
    expect([...rows[0].productNames].sort()).toEqual(["Product One", "Product Two"]);
    expect(rows[0].lastAddedAt).toEqual(new Date("2026-09-01T12:00:00Z"));
  });

  it("sorts by most recently active session first and respects the limit", () => {
    const rows = groupAbandonedCarts(
      [
        event({ sessionId: "old", createdAt: new Date("2026-09-01T00:00:00Z") }),
        event({ sessionId: "new", createdAt: new Date("2026-09-02T00:00:00Z") }),
      ],
      new Set(),
      new Map([["p1", "Product"]]),
      1,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionId).toBe("new");
  });

  it("falls back to a placeholder name for a product that no longer resolves", () => {
    const rows = groupAbandonedCarts([event({ productId: "gone" })], new Set(), new Map(), 50);
    expect(rows[0].productNames).toEqual(["Unknown product"]);
  });
});
