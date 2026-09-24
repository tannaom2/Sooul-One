import { describe, expect, it } from "vitest";
import { productAvailability, type AvailabilityInput } from "../src/lib/checkout/availability";

const DELIVERY = new Date("2026-10-05T00:00:00Z");
const days = (n: number) => new Date(DELIVERY.getTime() + n * 86_400_000);

const base: AvailabilityInput = {
  regulatoryType: "PACKAGED_FOOD",
  shelfLifeDays: 180,
  stockQuantity: 0,
  lowStockThreshold: 10,
  retailOnly: false,
  batches: [],
};

const batch = (id: string, expiresInDays: number, qty: number) => ({
  id,
  batchNumber: id,
  expiresOn: days(expiresInDays),
  quantityRemaining: qty,
});

describe("productAvailability", () => {
  it("is in stock when a batch has plenty of shelf life", () => {
    const a = productAvailability({ ...base, batches: [batch("B1", 170, 50)] }, DELIVERY);
    expect(a).toMatchObject({ state: "in", shippableUnits: 50, message: null });
  });

  it("the bug it fixes: only near-expiry stock left means out, whatever the stock counter says", () => {
    const a = productAvailability({ ...base, stockQuantity: 200, batches: [batch("OLD", 5, 200)] }, DELIVERY);
    expect(a.state).toBe("out");
    expect(a.reason).toBe("NO_COMPLIANT_BATCH");
    expect(a.message).toMatch(/too close to its best-before/);
  });

  it("counts only the batches that can lawfully ship, and quotes the first one's date", () => {
    const a = productAvailability({ ...base, batches: [batch("OLD", 5, 100), batch("MID", 150, 8), batch("NEW", 175, 30)] }, DELIVERY);
    expect(a.shippableUnits).toBe(38);
    expect(a.soonestBestBefore).toEqual(days(150));
  });

  it("is low at or below the owner's reorder threshold", () => {
    expect(productAvailability({ ...base, batches: [batch("B", 170, 10)] }, DELIVERY).state).toBe("low");
    expect(productAvailability({ ...base, batches: [batch("B", 170, 11)] }, DELIVERY).state).toBe("in");
  });

  it("says out of stock, not 'too short-dated', when batches are simply empty", () => {
    const a = productAvailability({ ...base, batches: [batch("B", 170, 0)] }, DELIVERY);
    expect(a).toMatchObject({ state: "out", reason: "OUT_OF_STOCK" });
  });

  it("falls back to the simple counter for products not tracked by batch", () => {
    expect(productAvailability({ ...base, stockQuantity: 4 }, DELIVERY)).toMatchObject({ state: "low", shippableUnits: 4, soonestBestBefore: null });
    expect(productAvailability({ ...base, stockQuantity: 0 }, DELIVERY)).toMatchObject({ state: "out", reason: "OUT_OF_STOCK" });
  });

  it("never offers retail-only products for delivery", () => {
    const a = productAvailability({ ...base, retailOnly: true, batches: [batch("B", 170, 50)] }, DELIVERY);
    expect(a).toMatchObject({ state: "retail-only", shippableUnits: 0 });
  });
});
