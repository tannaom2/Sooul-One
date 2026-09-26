import { describe, expect, it } from "vitest";
import { buildQuote, type QuoteLineInput } from "../src/lib/checkout/quote";
import type { BundleRule } from "../src/lib/checkout/bundles";
import { groupKits } from "../src/lib/checkout/kits";
import { toPaise } from "../src/lib/money";

const batch = { id: "b1", batchNumber: "B1", expiresOn: new Date("2027-12-31"), quantityRemaining: 50 };
const product = (productId: string, rupees: string, quantity = 1, over: Partial<QuoteLineInput> = {}): QuoteLineInput => ({
  productId,
  name: productId.toUpperCase(),
  regulatoryType: "HEALTH_SUPPLEMENT",
  unitPricePaise: toPaise(rupees),
  quantity,
  taxRatePercent: 18,
  batches: [batch],
  ...over,
});
const kitRule = (over: Partial<BundleRule> = {}): BundleRule => ({
  id: "kit",
  name: "Growing-Up Kit",
  minItems: 2,
  discountType: "PERCENTAGE",
  discountValue: 12,
  eligibleProductIds: ["multi", "calcium", "lutein"],
  ...over,
});
const quote = (lines: QuoteLineInput[], bundles = [kitRule()]) =>
  buildQuote({ lines, bundles, estimatedDeliveryDate: new Date("2026-10-03"), gstTreatment: "INTRA_STATE" });

describe("groupKits", () => {
  it("shows two of each as two kits at the kit price", () => {
    const [kit] = groupKits(quote([product("multi", "499", 2), product("calcium", "449", 2)]));
    expect(kit).toMatchObject({ name: "Growing-Up Kit", sets: 2, uniform: true, salePaise: toPaise("1896") });
    expect(kit.savingPaise).toBe(toPaise("226"));
    expect(kit.kitPaise).toBe(toPaise("1670"));
    expect(kit.members.map((m) => [m.productId, m.units])).toEqual([["multi", 2], ["calcium", 2]]);
    expect(kit.completeWith).toEqual([]);
  });

  it("offers to complete another kit when there are spare units", () => {
    const [kit] = groupKits(quote([product("multi", "499", 3), product("calcium", "449", 2)]));
    expect(kit.sets).toBe(2);
    expect(kit.completeWith).toEqual([{ productId: "calcium", name: "CALCIUM" }]);
    expect(kit.nextKitSavingPaise).toBe(toPaise("113"));
  });

  it("doesn't offer another kit when a product is short of stock", () => {
    const short = { ...batch, quantityRemaining: 2 };
    const [kit] = groupKits(quote([product("multi", "499", 3), product("calcium", "449", 3, { batches: [short] })]));
    expect(kit.completeWith).toEqual([]);
  });

  it("marks mix-and-match kits of different products as not uniform", () => {
    const [kit] = groupKits(quote([product("multi", "499", 2), product("calcium", "449"), product("lutein", "399")], [kitRule({ maxItems: 2 })]));
    expect(kit.sets).toBe(2);
    expect(kit.uniform).toBe(false);
    expect(kit.members.find((m) => m.productId === "multi")?.units).toBe(2);
  });

  it("leaves out a combo that saved nothing", () => {
    // Both products already sell below the kit price.
    const sale = { listPricePaise: toPaise("499") };
    const kits = groupKits(
      quote([product("multi", "300", 1, sale), product("calcium", "300", 1, { listPricePaise: toPaise("449") })]),
    );
    expect(kits).toEqual([]);
  });

  it("matches what checkout charges", () => {
    const q = quote([product("multi", "499", 3), product("calcium", "449", 2)]);
    const [kit] = groupKits(q);
    expect(q.bundleDiscountPaise).toBe(kit.savingPaise);
    expect(q.totalPaise).toBe(q.subtotalPaise - kit.savingPaise);
  });
});
