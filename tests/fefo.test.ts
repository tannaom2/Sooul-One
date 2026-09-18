import { describe, expect, it } from "vitest";
import { allocateFefo, findNearExpiryBatches } from "../src/lib/compliance/fefo";
import type { BatchLike } from "../src/lib/compliance/shelf-life";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** 180-day shelf life => 54 days must remain at delivery. */
const SHELF_LIFE = 180;
const DELIVERY = d("2026-06-01");

const batch = (
  id: string,
  expiresOn: string,
  quantityRemaining: number,
  batchNumber = id,
): BatchLike => ({ id, batchNumber, expiresOn: d(expiresOn), quantityRemaining });

describe("allocateFefo", () => {
  it("draws from the earliest-expiring eligible batch first", () => {
    const batches = [
      batch("late", "2026-12-01", 50),
      batch("early", "2026-09-01", 50),
      batch("mid", "2026-10-01", 50),
    ];

    const result = allocateFefo(batches, 30, SHELF_LIFE, DELIVERY);

    expect(result.fulfilled).toBe(true);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].batchId).toBe("early");
  });

  it("does not depend on the order batches arrive in", () => {
    const forwards = [batch("a", "2026-09-01", 10), batch("b", "2026-10-01", 10)];
    const backwards = [...forwards].reverse();

    expect(allocateFefo(forwards, 5, SHELF_LIFE, DELIVERY).allocations[0].batchId).toBe(
      allocateFefo(backwards, 5, SHELF_LIFE, DELIVERY).allocations[0].batchId,
    );
  });

  it("does not mutate the caller's array", () => {
    const batches = [batch("late", "2026-12-01", 5), batch("early", "2026-09-01", 5)];
    const snapshot = batches.map((b) => b.id);

    allocateFefo(batches, 3, SHELF_LIFE, DELIVERY);

    expect(batches.map((b) => b.id)).toEqual(snapshot);
  });

  it("spans multiple batches in expiry order when one cannot cover the quantity", () => {
    const batches = [
      batch("early", "2026-09-01", 10),
      batch("mid", "2026-10-01", 10),
      batch("late", "2026-11-01", 10),
    ];

    const result = allocateFefo(batches, 25, SHELF_LIFE, DELIVERY);

    expect(result.fulfilled).toBe(true);
    expect(result.allocations.map((a) => [a.batchId, a.quantity])).toEqual([
      ["early", 10],
      ["mid", 10],
      ["late", 5],
    ]);
  });

  it("skips a near-expiry batch and takes the next compliant one", () => {
    // 2026-06-20 leaves 19 days at delivery — under the 54 required.
    const batches = [batch("shortdated", "2026-06-20", 100), batch("good", "2026-11-01", 100)];

    const result = allocateFefo(batches, 10, SHELF_LIFE, DELIVERY);

    expect(result.allocations[0].batchId).toBe("good");
    expect(result.rejected.map((r) => r.batchId)).toContain("shortdated");
    expect(result.rejected[0].reason).toBe("INSUFFICIENT_REMAINING_SHELF_LIFE");
  });

  it("reports a shortfall rather than silently under-filling", () => {
    const result = allocateFefo([batch("only", "2026-11-01", 4)], 10, SHELF_LIFE, DELIVERY);

    expect(result.fulfilled).toBe(false);
    expect(result.quantityAllocated).toBe(4);
    expect(result.quantityShort).toBe(6);
  });

  it("allocates nothing when every batch is non-compliant, and says why", () => {
    const batches = [batch("a", "2026-06-10", 100), batch("b", "2026-06-15", 100)];

    const result = allocateFefo(batches, 5, SHELF_LIFE, DELIVERY);

    expect(result.fulfilled).toBe(false);
    expect(result.quantityAllocated).toBe(0);
    expect(result.rejected).toHaveLength(2);
  });

  it("ignores empty batches", () => {
    const batches = [batch("empty", "2026-09-01", 0), batch("stocked", "2026-10-01", 10)];

    const result = allocateFefo(batches, 5, SHELF_LIFE, DELIVERY);

    expect(result.allocations[0].batchId).toBe("stocked");
    expect(result.rejected[0].reason).toBe("OUT_OF_STOCK");
  });

  it("breaks expiry ties deterministically by batch number", () => {
    const batches = [
      batch("x", "2026-09-01", 10, "B-002"),
      batch("y", "2026-09-01", 10, "B-001"),
    ];

    expect(allocateFefo(batches, 5, SHELF_LIFE, DELIVERY).allocations[0].batchNumber).toBe(
      "B-001",
    );
  });

  it("refuses a non-positive or fractional quantity", () => {
    const batches = [batch("a", "2026-11-01", 10)];
    expect(() => allocateFefo(batches, 0, SHELF_LIFE, DELIVERY)).toThrow(RangeError);
    expect(() => allocateFefo(batches, 2.5, SHELF_LIFE, DELIVERY)).toThrow(RangeError);
  });
});

describe("findNearExpiryBatches", () => {
  it("warns on batches nearing unsellable, not nearing expiry", () => {
    // Required remaining is 54 days. A batch expiring 2026-07-20 has 49 days
    // left as of 2026-06-01 — already 5 days past unsellable, yet nowhere near
    // its printed expiry. Alerting on expiry alone would miss this entirely.
    const batches = [
      batch("becoming-unsellable", "2026-07-20", 40),
      batch("healthy", "2027-01-01", 40),
    ];

    const results = findNearExpiryBatches(batches, SHELF_LIFE, DELIVERY);

    expect(results).toHaveLength(1);
    expect(results[0].batchId).toBe("becoming-unsellable");
    expect(results[0].daysUntilUnsellable).toBe(-5);
  });

  it("sorts most urgent first", () => {
    const batches = [
      batch("later", "2026-08-01", 10),
      batch("sooner", "2026-07-01", 10),
      batch("soonest", "2026-06-15", 10),
    ];

    const results = findNearExpiryBatches(batches, SHELF_LIFE, DELIVERY, 60);

    expect(results.map((r) => r.batchId)).toEqual(["soonest", "sooner", "later"]);
  });

  it("does not report depleted batches", () => {
    const batches = [batch("empty", "2026-06-10", 0)];
    expect(findNearExpiryBatches(batches, SHELF_LIFE, DELIVERY)).toHaveLength(0);
  });

  it("respects the warning window", () => {
    const batches = [batch("a", "2026-08-01", 10)]; // 7 days of headroom
    expect(findNearExpiryBatches(batches, SHELF_LIFE, DELIVERY, 3)).toHaveLength(0);
    expect(findNearExpiryBatches(batches, SHELF_LIFE, DELIVERY, 14)).toHaveLength(1);
  });
});
