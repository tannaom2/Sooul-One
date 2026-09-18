import { describe, expect, it } from "vitest";
import {
  assessShippability,
  evaluateBatchForDelivery,
  requiredRemainingDays,
  wholeDaysBetween,
  type BatchLike,
} from "../src/lib/compliance/shelf-life";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("requiredRemainingDays — anchored on FSSAI's published examples", () => {
  // These two cases are the reason the implementation reads the way it does.
  // If either ever fails, the interpretation of the rule has drifted.
  it("a 10-day shelf life requires 3 days remaining (regulator's butter example)", () => {
    expect(requiredRemainingDays(10)).toBe(3);
  });

  it("a 3-month shelf life requires 45 days remaining, not 27", () => {
    expect(requiredRemainingDays(90)).toBe(45);
  });

  it("a 6-month shelf life requires 54 days — the proportion overtakes the floor", () => {
    expect(requiredRemainingDays(180)).toBe(54);
  });

  it("rejects the min(30%, 45) misreading", () => {
    // Under min() a 90-day product would need only 27 days.
    expect(requiredRemainingDays(90)).not.toBe(27);
  });

  it("rejects the max(30%, 45) misreading", () => {
    // Under max() a 10-day product would need an impossible 45 days.
    expect(requiredRemainingDays(10)).not.toBe(45);
  });

  it("rounds up when the proportion lands between days", () => {
    expect(requiredRemainingDays(11)).toBe(4); // 3.3 -> 4
    expect(requiredRemainingDays(7)).toBe(3); // 2.1 -> 3
  });

  it("switches governance exactly at the 45-day boundary", () => {
    expect(requiredRemainingDays(44)).toBe(14); // ceil(13.2), floor unreachable
    expect(requiredRemainingDays(45)).toBe(45); // floor applies
  });

  it("honours a custom policy", () => {
    const policy = { minimumProportionRemaining: 0.5, minimumDaysFloor: 30 };
    expect(requiredRemainingDays(100, policy)).toBe(50);
    expect(requiredRemainingDays(20, policy)).toBe(10);
  });

  it("refuses nonsense input rather than returning a number", () => {
    expect(() => requiredRemainingDays(0)).toThrow(RangeError);
    expect(() => requiredRemainingDays(-5)).toThrow(RangeError);
    expect(() => requiredRemainingDays(Number.NaN)).toThrow(RangeError);
  });
});

describe("assessShippability", () => {
  it("flags a SKU that can never lawfully ship", () => {
    const result = assessShippability(45);
    expect(result.isShippable).toBe(false);
    expect(result.shippableWindowDays).toBe(0);
    expect(result.warning).toMatch(/retailOnly/);
  });

  it("warns on a punishingly narrow window", () => {
    const result = assessShippability(50); // needs 45, leaves 5
    expect(result.isShippable).toBe(true);
    expect(result.shippableWindowDays).toBe(5);
    expect(result.warning).toMatch(/frequent checkout blocks/);
  });

  it("passes a comfortable long-dated SKU without noise", () => {
    const result = assessShippability(365); // needs 110, leaves 255
    expect(result.isShippable).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("treats a short-dated SKU as shippable when the proportion governs", () => {
    const result = assessShippability(10); // needs 3, leaves 7
    expect(result.isShippable).toBe(true);
    expect(result.shippableWindowDays).toBe(7);
  });
});

describe("wholeDaysBetween", () => {
  it("ignores time of day", () => {
    const late = new Date("2026-03-01T23:50:00.000Z");
    const early = new Date("2026-03-02T00:10:00.000Z");
    expect(wholeDaysBetween(late, early)).toBe(1);
  });

  it("returns negative when the target is in the past", () => {
    expect(wholeDaysBetween(d("2026-03-10"), d("2026-03-01"))).toBe(-9);
  });
});

describe("evaluateBatchForDelivery", () => {
  const batch = (over: Partial<BatchLike> = {}): BatchLike => ({
    id: "b1",
    batchNumber: "B-001",
    expiresOn: d("2026-12-31"),
    quantityRemaining: 100,
    ...over,
  });

  it("accepts a batch with ample life left", () => {
    const v = evaluateBatchForDelivery(batch(), 180, d("2026-06-01"));
    expect(v.isEligible).toBe(true);
    expect(v.requiredRemainingDays).toBe(54);
    expect(v.daysRemainingAtDelivery).toBe(213);
  });

  it("rejects a batch that is merely near expiry, not expired", () => {
    // Expires 2026-06-20; delivery 2026-06-01 leaves 19 days, needs 54.
    const v = evaluateBatchForDelivery(
      batch({ expiresOn: d("2026-06-20") }),
      180,
      d("2026-06-01"),
    );
    expect(v.isEligible).toBe(false);
    expect(v.reason).toBe("INSUFFICIENT_REMAINING_SHELF_LIFE");
    expect(v.daysRemainingAtDelivery).toBe(19);
  });

  it("distinguishes expired from merely non-compliant", () => {
    const v = evaluateBatchForDelivery(
      batch({ expiresOn: d("2026-05-01") }),
      180,
      d("2026-06-01"),
    );
    expect(v.reason).toBe("EXPIRED");
  });

  it("reports out of stock ahead of shelf-life reasoning", () => {
    const v = evaluateBatchForDelivery(batch({ quantityRemaining: 0 }), 180, d("2026-06-01"));
    expect(v.reason).toBe("OUT_OF_STOCK");
  });

  it("judges against delivery date, not order date — the boundary case", () => {
    // Needs 54 days. Expiry 2026-08-01.
    // Ordered 2026-06-05 (57 days out) would pass; delivered 2026-06-09 (53) must not.
    const b = batch({ expiresOn: d("2026-08-01") });
    expect(evaluateBatchForDelivery(b, 180, d("2026-06-05")).isEligible).toBe(true);
    expect(evaluateBatchForDelivery(b, 180, d("2026-06-09")).isEligible).toBe(false);
  });

  it("accepts a batch sitting exactly on the threshold", () => {
    // Needs 54 days; delivery exactly 54 days before expiry.
    const v = evaluateBatchForDelivery(
      batch({ expiresOn: d("2026-07-25") }),
      180,
      d("2026-06-01"),
    );
    expect(v.daysRemainingAtDelivery).toBe(54);
    expect(v.isEligible).toBe(true);
  });

  it("rejects one day under the threshold", () => {
    const v = evaluateBatchForDelivery(
      batch({ expiresOn: d("2026-07-24") }),
      180,
      d("2026-06-01"),
    );
    expect(v.daysRemainingAtDelivery).toBe(53);
    expect(v.isEligible).toBe(false);
  });
});
