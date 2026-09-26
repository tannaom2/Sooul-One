import { describe, expect, it } from "vitest";
import { applyBundles, comboPrice, type BundleRule } from "../src/lib/checkout/bundles";
import { growKitOptions } from "../src/lib/checkout/basket-nudges";
import { bundleOfferProblem, stepUpAddOnPercent } from "../src/lib/validation/bundle";
import { toPaise } from "../src/lib/money";

// "Buy 2 save 12%, buy 3 save 15%": the Growing-Up Kit with its step-up.
const growing: BundleRule = {
  id: "growing",
  name: "Growing-Up Kit",
  minItems: 2,
  maxItems: 3,
  discountType: "PERCENTAGE",
  discountValue: 12,
  stepUpValue: 15,
  eligibleProductIds: ["multi", "calcium", "vitc", "lutein"],
};
const list = new Map([
  ["multi", toPaise("499")],
  ["calcium", toPaise("449")],
  ["vitc", toPaise("399")],
  ["lutein", toPaise("429")],
]);
const at = (productId: string, quantity = 1) => ({ productId, unitPaise: list.get(productId)!, quantity });

describe("step-up pricing", () => {
  it("keeps the main discount for a kit of the minimum size", () => {
    expect(applyBundles([at("multi"), at("calcium")], [growing]).totalPaise).toBe(toPaise("113")); // 12% of ₹948
  });

  it("moves a kit with one more product to the step-up", () => {
    expect(applyBundles([at("multi"), at("calcium"), at("vitc")], [growing]).totalPaise).toBe(toPaise("202")); // 15% of ₹1,347
  });

  it("prices each kit by its own size", () => {
    // Kit 1: multi + calcium + vitc at 15% (₹202); kit 2: multi + calcium at 12% (₹113).
    expect(applyBundles([at("multi", 2), at("calcium", 2), at("vitc")], [growing]).totalPaise).toBe(toPaise("315"));
  });

  it("shows the product page the same price as the basket", () => {
    const c = comboPrice(growing, ["multi", "calcium", "vitc"].map((id) => ({ productId: id, unitListPaise: list.get(id)!, unitSalePaise: list.get(id)! })));
    expect(c).toMatchObject({ savingPaise: toPaise("202"), comboPaise: toPaise("1145") });
  });
});

describe("growKitOptions", () => {
  it("suggests products that step a kit up, with the saving each adds, cheapest first", () => {
    const options = growKitOptions("growing", [at("multi"), at("calcium")], [growing], [
      { productId: "multi", listPaise: list.get("multi")! },
      { productId: "lutein", listPaise: list.get("lutein")! },
      { productId: "vitc", listPaise: list.get("vitc")! },
    ]);
    // Already in the basket: skipped. Vitamin C: ₹202 − ₹113 = ₹89 more.
    expect(options.map((o) => o.productId)).toEqual(["vitc", "lutein"]);
    expect(options[0].savingPaise).toBe(toPaise("89"));
  });

  it("suggests nothing when the kit is already at its most products", () => {
    const options = growKitOptions("growing", [at("multi"), at("calcium"), at("vitc")], [growing], [{ productId: "lutein", listPaise: list.get("lutein")! }]);
    expect(options).toEqual([]);
  });

  it("suggests nothing for a two-product kit with no step-up and no room", () => {
    const capped: BundleRule = { ...growing, stepUpValue: null, maxItems: 2 };
    expect(growKitOptions("growing", [at("multi"), at("calcium")], [capped], [{ productId: "vitc", listPaise: list.get("vitc")! }])).toEqual([]);
  });
});

describe("step-up validation", () => {
  const offer = { discountType: "PERCENTAGE", discountValue: 12, minItems: 2, maxItems: 3, eligiblePricesPaise: [49_900, 44_900, 39_900] };

  it("accepts a step-up above the main discount", () => {
    expect(bundleOfferProblem({ ...offer, stepUpValue: 15 })).toBeNull();
  });

  it("refuses a step-up that isn't bigger", () => {
    expect(bundleOfferProblem({ ...offer, stepUpValue: 12 })).toMatch(/bigger than the main discount/);
  });

  it("refuses a step-up with no third product to choose", () => {
    expect(bundleOfferProblem({ ...offer, eligiblePricesPaise: [49_900, 44_900], stepUpValue: 15 })).toMatch(/at least 3 products/);
  });

  it("refuses a step-up that gives the extra product almost everything", () => {
    expect(bundleOfferProblem({ ...offer, stepUpValue: 40 })).toMatch(/in effect/); // 3 × 40 − 2 × 12 = 96%
  });

  it("works out what the extra product really gets", () => {
    expect(stepUpAddOnPercent(2, 12, 15)).toBe(21);
  });
});
