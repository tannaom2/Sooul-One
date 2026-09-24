import { describe, expect, it } from "vitest";
import { freeDeliveryProgress, nextOfferNudge } from "../src/lib/checkout/basket-nudges";
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

  it("prefers the nearest offer, then the bigger discount", () => {
    const near = rule({ id: "near", minItems: 2, discountValue: 5, eligibleProductIds: ["g1", "x"] });
    const far = rule({ id: "far", minItems: 3, discountValue: 30 });
    const bigger = rule({ id: "bigger", minItems: 2, discountValue: 10, eligibleProductIds: ["g1", "y"] });
    expect(nextOfferNudge(["g1"], [far, near, bigger], [])?.bundleId).toBe("bigger");
  });

  it("never nudges toward an offer that can't be completed", () => {
    expect(nextOfferNudge(["g1"], [rule({ minItems: 3, eligibleProductIds: ["g1", "g2"] })], [])).toBeNull();
  });
});
