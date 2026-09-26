import { describe, expect, it } from "vitest";
import { applyBundles, comboPrice, type BundleRule } from "../src/lib/checkout/bundles";
import { buildQuote, type QuoteLineInput } from "../src/lib/checkout/quote";
import { toPaise } from "../src/lib/money";

const rule = (over: Partial<BundleRule> = {}): BundleRule => ({
  id: "hamper",
  name: "Diwali Hamper",
  minItems: 2,
  discountType: "PERCENTAGE",
  discountValue: 10,
  eligibleProductIds: ["a", "b", "c"],
  ...over,
});

const line = (productId: string, rupees: string, quantity = 1) => ({ productId, unitPaise: toPaise(rupees), quantity });

describe("applyBundles", () => {
  it("applies when enough distinct eligible products are present", () => {
    const r = applyBundles([line("a", "200"), line("b", "300")], [rule()]);
    expect(r.totalPaise).toBe(toPaise("50"));
    expect(r.applied.map((b) => b.name)).toEqual(["Diwali Hamper"]);
    expect(r.perLineBundle).toEqual(["Diwali Hamper", "Diwali Hamper"]);
  });

  it("does not apply below minItems", () => {
    expect(applyBundles([line("a", "200")], [rule()]).totalPaise).toBe(0);
  });

  it("ignores products outside the bundle", () => {
    expect(applyBundles([line("a", "200"), line("z", "300")], [rule()]).totalPaise).toBe(0);
  });

  it("ignores lines that cannot ship (no units)", () => {
    expect(applyBundles([line("a", "200"), line("b", "300", 0)], [rule()]).totalPaise).toBe(0);
  });

  it("splits the discount across lines so the parts sum exactly", () => {
    const r = applyBundles(
      [line("a", "100.01"), line("b", "100.02"), line("c", "100.03")],
      [rule({ discountValue: 7 })],
    );
    expect(r.perLinePaise.reduce((a, b) => a + b, 0)).toBe(r.totalPaise);
  });

  it("caps at maxItems, discounting the highest-value lines", () => {
    const r = applyBundles(
      [line("a", "100"), line("b", "300"), line("c", "200")],
      [rule({ maxItems: 2 })],
    );
    expect(r.perLinePaise[0]).toBe(0);
    expect(r.totalPaise).toBe(toPaise("50"));
  });

  it("supports a flat amount, clamped to the value of the lines", () => {
    const r = applyBundles(
      [line("a", "20"), line("b", "30")],
      [rule({ discountType: "FLAT", discountValue: 100 })],
    );
    expect(r.totalPaise).toBe(toPaise("50"));
  });

  it("never stacks two bundles on the same line: the bigger saving wins", () => {
    const small = rule({ id: "small", name: "Small", discountValue: 5 });
    const big = rule({ id: "big", name: "Big", discountValue: 20 });
    const r = applyBundles([line("a", "200"), line("b", "300")], [small, big]);
    expect(r.applied.map((b) => b.id)).toEqual(["big"]);
    expect(r.totalPaise).toBe(toPaise("100"));
  });

  it("applies a second bundle to lines the first did not claim", () => {
    const first = rule({ id: "one", name: "One", eligibleProductIds: ["a", "b"], discountValue: 20 });
    const second = rule({ id: "two", name: "Two", eligibleProductIds: ["c", "d"], discountValue: 10 });
    const r = applyBundles(
      [line("a", "100"), line("b", "100"), line("c", "100"), line("d", "100")],
      [first, second],
    );
    expect(r.applied.map((b) => b.id).sort()).toEqual(["one", "two"]);
    expect(r.totalPaise).toBe(toPaise("60"));
  });
});

const batch = { id: "B", batchNumber: "B", expiresOn: new Date("2027-12-01"), quantityRemaining: 100 };
const product = (
  productId: string,
  rupees: string,
  over: Partial<QuoteLineInput> = {},
): QuoteLineInput => ({
  productId,
  name: productId,
  regulatoryType: "PACKAGED_FOOD",
  unitPricePaise: toPaise(rupees),
  quantity: 1,
  taxRatePercent: 12,
  shelfLifeDays: 180,
  batches: [batch],
  ...over,
});
const base = { estimatedDeliveryDate: new Date("2026-06-01"), gstTreatment: "INTRA_STATE" as const };

describe("bundles inside the quote", () => {
  it("takes the bundle off the total and reports it", () => {
    const q = buildQuote({ ...base, lines: [product("a", "500"), product("b", "500")], bundles: [rule()] });
    expect(q.subtotalPaise).toBe(toPaise("1000"));
    expect(q.bundleDiscountPaise).toBe(toPaise("100"));
    expect(q.totalPaise).toBe(toPaise("900"));
    expect(q.appliedBundles).toHaveLength(1);
  });

  it("applies a code only to items outside the combo, and computes GST after both", () => {
    // a + b form the combo (10% off: 1000 -> 900); z is outside it. The 10%
    // code discounts only z (500 -> 450): offers aren't clubbed.
    const q = buildQuote({
      ...base,
      lines: [product("a", "500"), product("b", "500"), product("z", "500")],
      bundles: [rule()],
      coupon: { code: "X", type: "PERCENTAGE", value: 10 },
    });
    expect(q.bundleDiscountPaise).toBe(toPaise("100"));
    expect(q.discountPaise).toBe(toPaise("50"));
    expect(q.lines.map((l) => l.discountPaise)).toEqual([0, 0, toPaise("50")]);
    expect(q.totalPaise).toBe(toPaise("1350"));
    expect(q.taxPaise).toBe(2 * Math.round((toPaise("450") * 12) / 112) + Math.round((toPaise("450") * 12) / 112));
    expect(q.lines.reduce((s, l) => s + l.bundleDiscountPaise + l.discountPaise, 0)).toBe(q.bundleDiscountPaise + q.discountPaise);
  });

  it("says when a code saved nothing because every item is in a combo", () => {
    const q = buildQuote({
      ...base,
      lines: [product("a", "500"), product("b", "500")],
      bundles: [rule()],
      coupon: { code: "X", type: "PERCENTAGE", value: 10 },
    });
    expect(q.discountPaise).toBe(0);
    expect(q.appliedCouponCode).toBeUndefined();
    expect(q.couponBlockedByCombo).toBe(true);
  });

  it("uses the discounted total for the free-shipping threshold", () => {
    const q = buildQuote({
      ...base,
      lines: [product("a", "450"), product("b", "400")],
      bundles: [rule({ discountValue: 20 })],
    });
    expect(q.shippingPaise).toBeGreaterThan(0);
    expect(q.totalPaise).toBe(toPaise("680") + q.shippingPaise);
  });

  it("carries product-level discounts: list vs paid, and only shippable lines", () => {
    const q = buildQuote({
      ...base,
      lines: [
        product("a", "470", { listPricePaise: toPaise("500"), quantity: 2 }),
        product("b", "100", { quantity: 1, stockQuantity: 0, batches: [] }),
      ],
    });
    expect(q.lines[0].listGrossPaise).toBe(toPaise("1000"));
    expect(q.lines[0].grossPaise).toBe(toPaise("940"));
    expect(q.lines[0].productDiscountPaise).toBe(toPaise("60"));
    expect(q.listSubtotalPaise).toBe(toPaise("1000"));
    expect(q.productDiscountPaise).toBe(toPaise("60"));
    expect(q.subtotalPaise).toBe(toPaise("940"));
  });

  it("leaves existing behaviour alone when there are no bundles or discounts", () => {
    const q = buildQuote({ ...base, lines: [product("a", "500")] });
    expect(q.bundleDiscountPaise).toBe(0);
    expect(q.productDiscountPaise).toBe(0);
    expect(q.listSubtotalPaise).toBe(q.subtotalPaise);
  });

  describe("a product discount and a bundle never stack", () => {
    it("prices the bundle off MRP, not off the already-discounted price", () => {
      // "a" has its own 10% product discount (500 -> 450); the bundle is 10%
      // off MRP. Off MRP that's also 500 -> 450, so on this line the two land
      // on the same price — the bundle should not additionally discount the
      // already-discounted 450.
      const q = buildQuote({
        ...base,
        lines: [
          product("a", "450", { listPricePaise: toPaise("500") }),
          product("b", "500"),
        ],
        bundles: [rule()],
      });
      // Line a: product discount (50) already matches what the bundle would
      // have given off MRP, so the bundle adds nothing further to it.
      expect(q.lines[0].productDiscountPaise).toBe(toPaise("50"));
      expect(q.lines[0].bundleDiscountPaise).toBe(0);
      // Line b has no product discount, so the full 10%-off-MRP bundle share
      // for it lands entirely as bundle discount.
      expect(q.lines[1].bundleDiscountPaise).toBe(toPaise("50"));
    });

    it("gives the shopper the deeper of the two discounts, never both", () => {
      // "a" has a steep 30% product discount (1000 -> 700). The bundle is only
      // 10% off MRP (1000 -> 900 for this line's share). The product discount
      // is deeper, so the customer keeps paying 700 for it — the bundle must
      // not additionally reduce that 700.
      const q = buildQuote({
        ...base,
        lines: [
          product("a", "700", { listPricePaise: toPaise("1000") }),
          product("b", "1000"),
        ],
        bundles: [rule()],
      });
      expect(q.lines[0].grossPaise).toBe(toPaise("700"));
      expect(q.lines[0].bundleDiscountPaise).toBe(0);
      expect(q.lines[0].bundleName).toBeUndefined();
      // The line actually pays 700, backed out via GST, same as if no bundle existed.
      const combinedPreCoupon = q.lines[0].taxablePaise + q.lines[0].taxPaise;
      expect(combinedPreCoupon).toBe(toPaise("700"));
    });

    it("lets the bundle win when it beats the product discount", () => {
      // "a" has a shallow 5% product discount (1000 -> 950). The bundle is 10%
      // off MRP (1000 -> 900), which is better — the customer should end up
      // paying 900, and the improvement over the product discount (50) shows
      // as the bundle's contribution.
      const q = buildQuote({
        ...base,
        lines: [
          product("a", "950", { listPricePaise: toPaise("1000") }),
          product("b", "1000"),
        ],
        bundles: [rule()],
      });
      expect(q.lines[0].bundleDiscountPaise).toBe(toPaise("50"));
      expect(q.lines[0].bundleName).toBe("Diwali Hamper");
      const combinedPreCoupon = q.lines[0].taxablePaise + q.lines[0].taxPaise;
      expect(combinedPreCoupon).toBe(toPaise("900"));
    });
  });
});

describe("combos are priced per complete set (peer practice, protects margin)", () => {
  it("one cheap add-on doesn't discount twenty jars: only one set forms", () => {
    const r = applyBundles([line("a", "500", 20), line("b", "100", 1)], [rule()]);
    expect(r.applied[0].sets).toBe(1);
    expect(r.perLineUnits).toEqual([1, 1]);
    expect(r.totalPaise).toBe(toPaise("60")); // 10% of one A (500) + one B (100)
  });

  it("two of each makes two sets", () => {
    const r = applyBundles([line("a", "200", 2), line("b", "300", 2)], [rule()]);
    expect(r.applied[0].sets).toBe(2);
    expect(r.totalPaise).toBe(toPaise("100"));
  });

  it("a fixed combo (every product required) needs all of them", () => {
    const fixed = rule({ minItems: 3 });
    expect(applyBundles([line("a", "200"), line("b", "300")], [fixed]).totalPaise).toBe(0);
    expect(applyBundles([line("a", "200"), line("b", "300"), line("c", "100")], [fixed]).totalPaise).toBe(toPaise("60"));
  });

  it("in the quote, extra units pay their normal price", () => {
    const q = buildQuote({ ...base, lines: [product("a", "500", { quantity: 3 }), product("b", "500")], bundles: [rule()] });
    expect(q.bundleDiscountPaise).toBe(toPaise("100")); // 10% of one a + one b, not of all four
    expect(q.totalPaise).toBe(toPaise("1900"));
  });

  it("a sale on extra units doesn't hide the combo saving on the set unit", () => {
    // a: MRP 1000, on sale at 950, three of them. The combo is 10% off MRP
    // (900 for the set unit), which beats 950 on that one unit only.
    const q = buildQuote({
      ...base,
      lines: [product("a", "950", { listPricePaise: toPaise("1000"), quantity: 3 }), product("b", "1000")],
      bundles: [rule()],
    });
    expect(q.lines[0].bundleDiscountPaise).toBe(toPaise("50"));
    expect(q.lines[1].bundleDiscountPaise).toBe(toPaise("100"));
  });
});

describe("comboPrice, for the storefront", () => {
  it("states list, sale, combo price and saving with the basket's own arithmetic", () => {
    const c = comboPrice(rule(), [
      { productId: "a", unitListPaise: toPaise("500"), unitSalePaise: toPaise("500") },
      { productId: "b", unitListPaise: toPaise("300"), unitSalePaise: toPaise("270") },
    ]);
    // Off MRP: 800 -> 720 (a 450, b 270). b's own sale price already is 270.
    expect(c).toEqual({ listPaise: toPaise("800"), salePaise: toPaise("770"), comboPaise: toPaise("720"), savingPaise: toPaise("50") });
  });

  it("returns nothing when the items don't make a set", () => {
    expect(comboPrice(rule(), [{ productId: "a", unitListPaise: 1000, unitSalePaise: 1000 }])).toBeNull();
  });
});

describe("whole-rupee kit savings", () => {
  it("rounds a percentage saving down to the rupee", () => {
    // 12% of ₹948 is ₹113.76: the kit saves ₹113, never more than the rule.
    const r = applyBundles([line("a", "499"), line("b", "449")], [rule({ discountValue: 12 })]);
    expect(r.totalPaise).toBe(toPaise("113"));
    expect(r.perLinePaise.reduce((a, b) => a + b, 0)).toBe(r.totalPaise);
  });

  it("rounds per kit, so two kits save exactly twice one", () => {
    const r = applyBundles([line("a", "499", 2), line("b", "449", 2)], [rule({ discountValue: 12 })]);
    expect(r.totalPaise).toBe(toPaise("226"));
  });

  it("prices a kit in whole rupees on the product page too", () => {
    const c = comboPrice(rule({ discountValue: 12 }), [
      { productId: "a", unitListPaise: toPaise("499"), unitSalePaise: toPaise("499") },
      { productId: "b", unitListPaise: toPaise("449"), unitSalePaise: toPaise("449") },
    ]);
    expect(c).toMatchObject({ comboPaise: toPaise("835"), savingPaise: toPaise("113") });
  });
});

describe("kit makeup", () => {
  it("reports the products in each kit when every kit is the same", () => {
    const r = applyBundles([line("a", "200", 2), line("b", "300", 2)], [rule()]);
    expect(r.applied[0].sets).toBe(2);
    expect([...(r.applied[0].perSet ?? [])].sort()).toEqual(["a", "b"]);
    expect(r.perLineBundleId).toEqual(["hamper", "hamper"]);
  });

  it("reports no single makeup when mix-and-match kits differ", () => {
    // Kit 1 takes the two dearest (c + b), kit 2 what's left (c + a).
    const r = applyBundles([line("a", "100"), line("b", "200"), line("c", "300", 2)], [rule({ maxItems: 2 })]);
    expect(r.applied[0].sets).toBe(2);
    expect(r.applied[0].perSet).toBeNull();
  });
});
