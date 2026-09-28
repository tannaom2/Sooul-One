import { describe, expect, it } from "vitest";
import { boxIssues, boxIssueMessage, boxKindOf, boxMargin, daysOfCover, priceBox, slotTakes, wrongKindMessage, type BoxRule, type SlotFilter } from "../src/lib/checkout/boxes";

describe("box types never mix gummies and snacks", () => {
  it("puts the three gummies brands in gummies boxes and The True Store in its own", () => {
    for (const slug of ["woman-axis", "kids-vault", "man-rituals"]) expect(boxKindOf(slug)).toBe("GUMMIES");
    expect(boxKindOf("the-true-store")).toBe("TRUE_STORE");
    expect(boxKindOf("healthy-beverages")).toBeNull();
  });

  it("explains a wrong-type product in plain words", () => {
    expect(wrongKindMessage("GUMMIES", "Til Chikki")).toBe("Til Chikki is a snack, and this is a Box of Gummies.");
    expect(wrongKindMessage("TRUE_STORE", "Biotin Gummies")).toBe("Biotin Gummies is a gummy, and this is a True Store box.");
  });
});
import { buildQuote, type QuoteLineInput } from "../src/lib/checkout/quote";
import { toPaise } from "../src/lib/money";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const DELIVERY = d("2026-06-01");

const line = (productId: string, rupees: string, over: Partial<QuoteLineInput> = {}): QuoteLineInput => ({
  productId,
  name: productId,
  regulatoryType: "HEALTH_SUPPLEMENT",
  unitPricePaise: toPaise(rupees),
  quantity: 1,
  taxRatePercent: 18,
  shelfLifeDays: 730,
  batches: [{ id: `${productId}-b`, batchNumber: "B", expiresOn: d("2028-01-01"), quantityRemaining: 50 }],
  ...over,
});

const FAMILY: BoxRule = {
  id: "box1",
  name: "Family Box",
  size: 3,
  pricePaise: toPaise("999"),
  maxPerProduct: 1,
  slots: [
    { id: "her", label: "For her", minPicks: 0, maxPicks: null },
    { id: "kids", label: "For kids", minPicks: 1, maxPicks: 2 },
  ],
  eligible: new Map([
    ["biotin", "her"],
    ["multi-w", "her"],
    ["kids-multi", "kids"],
    ["kids-c", "kids"],
    ["kids-omega", "kids"],
  ]),
};

describe("a box's rules", () => {
  it("is complete with exactly the right number of eligible picks", () => {
    expect(boxIssues(FAMILY, [{ productId: "biotin", quantity: 1 }, { productId: "multi-w", quantity: 1 }, { productId: "kids-c", quantity: 1 }])).toEqual([]);
  });

  it("says how many are missing, and never counts a product outside the box", () => {
    const issues = boxIssues(FAMILY, [{ productId: "biotin", quantity: 1 }, { productId: "chips", quantity: 1 }]);
    expect(issues).toContainEqual({ kind: "TOO_FEW", missing: 1 });
    expect(issues).toContainEqual({ kind: "NOT_IN_BOX", productId: "chips" });
  });

  it("stops three of the same product and holds each section to its limits", () => {
    const same = boxIssues(FAMILY, [{ productId: "kids-c", quantity: 3 }]);
    expect(same).toContainEqual({ kind: "PRODUCT_LIMIT", productId: "kids-c" });
    expect(same).toContainEqual({ kind: "SLOT_MAX", slotId: "kids", label: "For kids", extra: 1 });
    const noKids = boxIssues(FAMILY, [{ productId: "biotin", quantity: 1 }, { productId: "multi-w", quantity: 1 }]);
    expect(noKids).toContainEqual({ kind: "SLOT_MIN", slotId: "kids", label: "For kids", missing: 1 });
  });

  it("explains each problem in the shopper's words", () => {
    expect(boxIssueMessage({ kind: "TOO_FEW", missing: 1 })).toBe("Pick 1 more to complete your box.");
    expect(boxIssueMessage({ kind: "SLOT_MIN", slotId: "kids", label: "For kids", missing: 1 })).toBe("Pick 1 more from “For kids”.");
  });
});

describe("pricing a box", () => {
  it("charges the box price, saving whole rupees, split by value", () => {
    const { discountPaise, shares } = priceBox(toPaise("999"), [
      { unitListPaise: toPaise("549"), units: 1 },
      { unitListPaise: toPaise("499"), units: 1 },
      { unitListPaise: toPaise("399.50"), units: 1 },
    ]);
    // 1,447.50 − 999 = 448.50, rounded down to ₹448.
    expect(discountPaise).toBe(toPaise("448"));
    expect(shares.reduce((a, b) => a + b, 0)).toBe(discountPaise);
    expect(shares.every((s) => s % 100 === 0)).toBe(true);
    expect(shares[0]).toBeGreaterThan(shares[2]);
  });

  it("never charges more than the items cost one by one", () => {
    expect(priceBox(toPaise("999"), [{ unitListPaise: toPaise("299"), units: 3 }]).discountPaise).toBe(0);
  });
});

describe("a box in the quote", () => {
  const boxLines = [line("biotin", "549", { boxId: "cb1" }), line("multi-w", "499", { boxId: "cb1" }), line("kids-c", "399", { boxId: "cb1" })];
  const box = { id: "cb1", boxId: "box1", name: "Family Box", pricePaise: toPaise("999"), complete: true };

  it("prices the three items at ₹999 in all", () => {
    const quote = buildQuote({ lines: boxLines, estimatedDeliveryDate: DELIVERY, gstTreatment: "INTRA_STATE", boxes: [box] });
    expect(quote.appliedBoxes).toEqual([expect.objectContaining({ id: "cb1", discountPaise: toPaise("448") })]);
    expect(quote.subtotalPaise - quote.bundleDiscountPaise).toBe(toPaise("999"));
    expect(quote.lines.every((l) => l.boxId === "cb1" && l.bundleName === "Family Box")).toBe(true);
  });

  it("gives no box price while the box is incomplete or an item can't ship", () => {
    const incomplete = buildQuote({ lines: boxLines, estimatedDeliveryDate: DELIVERY, gstTreatment: "INTRA_STATE", boxes: [{ ...box, complete: false }] });
    expect(incomplete.bundleDiscountPaise).toBe(0);
    const soldOut = [...boxLines.slice(0, 2), line("kids-c", "399", { boxId: "cb1", batches: [] , stockQuantity: 0 })];
    const blocked = buildQuote({ lines: soldOut, estimatedDeliveryDate: DELIVERY, gstTreatment: "INTRA_STATE", boxes: [box] });
    expect(blocked.appliedBoxes).toHaveLength(0);
  });

  it("keeps box items out of kits and discount codes", () => {
    const kit = { id: "k", name: "Kit", minItems: 2, discountType: "PERCENTAGE" as const, discountValue: 50, eligibleProductIds: ["biotin", "multi-w"] };
    const quote = buildQuote({
      lines: boxLines,
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
      boxes: [box],
      bundles: [kit],
      coupon: { code: "TEN", type: "PERCENTAGE", value: 10 },
    });
    expect(quote.appliedBundles).toHaveLength(0);
    expect(quote.discountPaise).toBe(0);
  });

  it("lets a sale price beat the box price for that item, never both", () => {
    const onSale = [line("biotin", "299", { boxId: "cb1", listPricePaise: toPaise("549") }), ...boxLines.slice(1)];
    const quote = buildQuote({ lines: onSale, estimatedDeliveryDate: DELIVERY, gstTreatment: "INTRA_STATE", boxes: [box] });
    const biotin = quote.lines[0];
    expect(biotin.grossPaise - biotin.bundleDiscountPaise).toBeLessThanOrEqual(toPaise("299"));
    expect(quote.subtotalPaise - quote.bundleDiscountPaise).toBeLessThanOrEqual(toPaise("999"));
  });
});

describe("the box editor's margin check", () => {
  it("shows the cheapest and dearest box and the worst-case margin", () => {
    const m = boxMargin(toPaise("999"), 3, 1, [
      { listPaise: toPaise("549"), costPaise: toPaise("200") },
      { listPaise: toPaise("499"), costPaise: toPaise("180") },
      { listPaise: toPaise("449"), costPaise: toPaise("150") },
      { listPaise: toPaise("349"), costPaise: toPaise("120") },
    ]);
    expect(m.maxValuePaise).toBe(toPaise("1497"));
    expect(m.minValuePaise).toBe(toPaise("1297"));
    expect(m.maxDiscountPercent).toBe(33.3);
    expect(m.worstMarginPaise).toBe(toPaise("469"));
  });

  it("won't guess a margin when a cost is missing, and flags a pool too small to fill a box", () => {
    expect(boxMargin(toPaise("999"), 3, 1, [{ listPaise: 1, costPaise: null }, { listPaise: 1, costPaise: 1 }, { listPaise: 1, costPaise: 1 }]).worstMarginPaise).toBeNull();
    expect(boxMargin(toPaise("999"), 3, 1, [{ listPaise: 1, costPaise: 1 }]).tooSmall).toBe(true);
  });
});

describe("filling a section from its rule", () => {
  const base: SlotFilter = { brandIds: ["wa"], categoryIds: [], minPricePaise: toPaise("349"), maxPricePaise: toPaise("549"), mode: "ALL", nearExpiryDays: null, minDaysOfCover: null };
  const product = { brandId: "wa", categoryId: "c", listPaise: toPaise("499"), shippableUnits: 40, daysToCutoff: 300, dailySales: 2 };

  it("takes sellable products of the section's brands within the price range", () => {
    expect(slotTakes(base, product)).toBe("in the price range");
    expect(slotTakes(base, { ...product, brandId: "other" })).toBeNull();
    expect(slotTakes(base, { ...product, listPaise: toPaise("599") })).toBeNull();
    expect(slotTakes(base, { ...product, shippableUnits: 0 })).toBeNull();
  });

  it("in clearance mode, takes only products near their cut-off or slow to sell", () => {
    const clearance: SlotFilter = { ...base, mode: "CLEARANCE", nearExpiryDays: 45, minDaysOfCover: 60 };
    expect(slotTakes(clearance, product)).toBeNull();
    expect(slotTakes(clearance, { ...product, daysToCutoff: 30 })).toBe("near its shipping cut-off: 30 days");
    expect(slotTakes(clearance, { ...product, dailySales: 0.5 })).toBe("slow-selling: 80 days of stock");
    expect(slotTakes(clearance, { ...product, dailySales: 0 })).toBe("slow-selling: no sales in 30 days");
  });

  it("measures stock in days at the recent sales rate", () => {
    expect(daysOfCover({ shippableUnits: 30, dailySales: 1.5 })).toBe(20);
    expect(daysOfCover({ shippableUnits: 30, dailySales: 0 })).toBe(Infinity);
  });
});

describe("referral credit in the quote", () => {
  const credit = { kind: "WALLET" as const, amountPaise: toPaise("100"), minOrderPaise: toPaise("799") };

  it("takes ₹100 off an order of ₹799 or more, on the goods, keeping free delivery", () => {
    const quote = buildQuote({ lines: [line("a", "449"), line("b", "399")], estimatedDeliveryDate: DELIVERY, gstTreatment: "INTRA_STATE", credit });
    expect(quote.creditPaise).toBe(toPaise("100"));
    expect(quote.creditKind).toBe("WALLET");
    expect(quote.shippingPaise).toBe(0);
    expect(quote.totalPaise).toBe(toPaise("748"));
    expect(quote.lines.reduce((n, l) => n + l.creditPaise, 0)).toBe(toPaise("100"));
  });

  it("says how far short an order is, and takes nothing off", () => {
    const quote = buildQuote({ lines: [line("a", "449")], estimatedDeliveryDate: DELIVERY, gstTreatment: "INTRA_STATE", credit });
    expect(quote.creditPaise).toBe(0);
    expect(quote.creditShortfallPaise).toBe(toPaise("350"));
  });

  it("counts the minimum after box savings", () => {
    const boxLines = [line("x", "549", { boxId: "cb" }), line("y", "499", { boxId: "cb" }), line("z", "399", { boxId: "cb" })];
    const quote = buildQuote({
      lines: boxLines,
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
      boxes: [{ id: "cb", boxId: "b", name: "Box", pricePaise: toPaise("999"), complete: true }],
      credit: { ...credit, minOrderPaise: toPaise("1000") },
    });
    expect(quote.creditPaise).toBe(0);
    expect(quote.creditShortfallPaise).toBe(toPaise("1"));
  });

  it("never combines with a discount code that applies", () => {
    const quote = buildQuote({
      lines: [line("a", "449"), line("b", "399")],
      estimatedDeliveryDate: DELIVERY,
      gstTreatment: "INTRA_STATE",
      credit,
      coupon: { code: "TEN", type: "PERCENTAGE", value: 10 },
    });
    expect(quote.discountPaise).toBeGreaterThan(0);
    expect(quote.creditPaise).toBe(0);
    expect(quote.creditBlockedByCoupon).toBe(true);
  });
});
