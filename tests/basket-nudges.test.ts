import { describe, expect, it } from "vitest";
import { toPaise } from "../src/lib/money";
import { freeDeliveryProgress, nextOfferNudge, settleNudge, type OfferNudge } from "../src/lib/checkout/basket-nudges";
import type { BundleRule } from "../src/lib/checkout/bundles";

describe("freeDeliveryProgress", () => {
  it("reports the gap and progress below the threshold", () => {
    expect(freeDeliveryProgress(65_300, 79_900)).toEqual({ qualified: false, gapPaise: 14_600, fraction: 65_300 / 79_900 });
  });

  it("qualifies at exactly the threshold, with no gap", () => {
    expect(freeDeliveryProgress(79_900, 79_900)).toEqual({ qualified: true, gapPaise: 0, fraction: 1 });
  });

  it("caps the bar at full above the threshold", () => {
    expect(freeDeliveryProgress(120_000, 79_900).fraction).toBe(1);
  });
});

const rule = (over: Partial<BundleRule>): BundleRule => ({
  id: "b1",
  name: "Any 3 gummies",
  minItems: 3,
  discountType: "PERCENTAGE",
  discountValue: 15,
  eligibleProductIds: ["g1", "g2", "g3", "g4"],
  ...over,
});

describe("nextOfferNudge", () => {
  it("points at the offer the shopper is one product away from", () => {
    const n = nextOfferNudge(["g1", "g2"], [rule({})], []);
    expect(n).toMatchObject({ bundleId: "b1", missing: 1, suggestProductIds: ["g3", "g4"] });
  });

  it("says nothing when the basket has none of the eligible products", () => {
    expect(nextOfferNudge(["snack"], [rule({})], [])).toBeNull();
  });

  it("says nothing once the offer is applied", () => {
    expect(nextOfferNudge(["g1", "g2", "g3"], [rule({})], ["b1"])).toBeNull();
  });

  it("stays quiet when the shopper is too far away", () => {
    expect(nextOfferNudge(["g1"], [rule({ minItems: 4 })], [])).toBeNull();
  });

  it("prefers the nearest offer, then the bigger saving", () => {
    const prices = new Map([["g1", 50000], ["x", 50000], ["y", 50000]]);
    const near = rule({ id: "near", minItems: 2, discountValue: 5, eligibleProductIds: ["g1", "x"] });
    const far = rule({ id: "far", minItems: 3, discountValue: 30 });
    const bigger = rule({ id: "bigger", minItems: 2, discountValue: 10, eligibleProductIds: ["g1", "y"] });
    expect(nextOfferNudge(["g1"], [far, near, bigger], [], prices)?.bundleId).toBe("bigger");
  });

  it("compares a percentage and a flat amount by what each saves, not by the number", () => {
    // A ₹500 + ₹500 set: 15% saves ₹150; ₹50 off saves ₹50, though 50 > 15.
    const prices = new Map([["g1", 50000], ["x", 50000], ["y", 50000]]);
    const percent = rule({ id: "pct", minItems: 2, discountType: "PERCENTAGE", discountValue: 15, eligibleProductIds: ["g1", "x"] });
    const flat = rule({ id: "flat", minItems: 2, discountType: "FLAT", discountValue: 50, eligibleProductIds: ["g1", "y"] });
    const nudge = nextOfferNudge(["g1"], [flat, percent], [], prices);
    expect(nudge?.bundleId).toBe("pct");
    expect(nudge?.savingPaise).toBe(15000);
  });

  it("suggests the cheapest products first", () => {
    const prices = new Map([["g1", 50000], ["dear", 90000], ["cheap", 20000]]);
    const nudge = nextOfferNudge(["g1"], [rule({ minItems: 2, eligibleProductIds: ["g1", "dear", "cheap"] })], [], prices);
    expect(nudge?.suggestProductIds).toEqual(["cheap", "dear"]);
  });

  it("never nudges toward an offer that can't be completed", () => {
    expect(nextOfferNudge(["g1"], [rule({ minItems: 3, eligibleProductIds: ["g1", "g2"] })], [])).toBeNull();
  });
});

describe("settleNudge", () => {
  const growing: BundleRule = {
    id: "growing", name: "Growing-Up Kit", minItems: 2, maxItems: 2, discountType: "PERCENTAGE", discountValue: 12,
    eligibleProductIds: ["multi", "calcium", "vitc"],
  };
  const duo: BundleRule = {
    id: "duo", name: "Immunity Duo", minItems: 2, discountType: "PERCENTAGE", discountValue: 10,
    eligibleProductIds: ["multi", "vitc"],
  };
  const list = new Map([["multi", toPaise("499")], ["calcium", toPaise("449")], ["vitc", toPaise("399")]]);
  const at = (productId: string, quantity: number) => ({ productId, unitPaise: list.get(productId)!, quantity });
  const nudgeFor = (rule: BundleRule, suggest: string[]): OfferNudge => ({
    bundleId: rule.id, name: rule.name, missing: 1, discountType: rule.discountType, discountValue: rule.discountValue,
    suggestProductIds: suggest, savingPaise: 0,
  });

  it("drops an offer whose product is already in another kit", () => {
    // Two Growing-Up kits: the multivitamins are taken, so vitamin C can't make an Immunity Duo.
    const basket = [at("multi", 2), at("calcium", 2)];
    expect(settleNudge(nudgeFor(duo, ["vitc"]), basket, [growing, duo], list)).toBeNull();
  });

  it("drops an offer a bigger one would beat", () => {
    // Multivitamin + vitamin C is also a Growing-Up pair at 12%, which wins over the Duo's 10%.
    expect(settleNudge(nudgeFor(duo, ["vitc"]), [at("multi", 1)], [growing, duo], list)).toBeNull();
  });

  it("keeps an offer that really applies, with its real saving", () => {
    const settled = settleNudge(nudgeFor(growing, ["vitc", "calcium"]), [at("multi", 1)], [growing, duo], list);
    expect(settled?.suggestProductIds).toEqual(["vitc", "calcium"]);
    expect(settled?.savingPaise).toBe(toPaise("107")); // 12% of ₹898 is ₹107.76, rounded down
  });
});
