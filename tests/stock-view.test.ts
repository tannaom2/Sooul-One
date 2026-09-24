import { describe, expect, it } from "vitest";
import { stockView } from "../src/lib/stock-view";

const now = new Date("2026-09-26T06:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);
const product = (batches: { expiresOn: Date; quantityRemaining: number }[], over: object = {}) => ({
  regulatoryType: "PACKAGED_FOOD" as const,
  shelfLifeDays: 180,
  stockQuantity: batches.reduce((s, b) => s + b.quantityRemaining, 0),
  lowStockThreshold: 10,
  retailOnly: false,
  batches: batches.map((b, i) => ({ id: `b${i}`, batchNumber: `B${i}`, ...b })),
  ...over,
});

describe("stockView", () => {
  it("counts only what the shop can ship: short-dated units are held but not sellable", () => {
    const v = stockView(product([{ expiresOn: days(170), quantityRemaining: 30 }, { expiresOn: days(10), quantityRemaining: 12 }]), now);
    expect(v).toEqual({ held: 42, shippable: 30, tooShortDated: 12, low: false });
  });

  it("warns when shippable stock is at or below the reorder level, even with plenty held", () => {
    const v = stockView(product([{ expiresOn: days(170), quantityRemaining: 8 }, { expiresOn: days(5), quantityRemaining: 200 }]), now);
    expect(v.shippable).toBe(8);
    expect(v.low).toBe(true);
  });

  it("treats a product with no batches as having nothing to sell", () => {
    expect(stockView(product([]), now)).toEqual({ held: 0, shippable: 0, tooShortDated: 0, low: true });
  });

  it("never counts store-only stock as shippable or short-dated", () => {
    const v = stockView(product([{ expiresOn: days(170), quantityRemaining: 50 }], { retailOnly: true }), now);
    expect(v).toMatchObject({ held: 50, shippable: 0, tooShortDated: 0 });
  });
});
