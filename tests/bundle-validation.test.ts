import { describe, expect, it } from "vitest";
import { bundleOfferProblem } from "../src/lib/validation/bundle";

const offer = (o: Partial<Parameters<typeof bundleOfferProblem>[0]> = {}) => ({
  discountType: "PERCENTAGE",
  discountValue: 15,
  minItems: 2,
  maxItems: null,
  eligiblePricesPaise: [49900, 59900, 69900],
  ...o,
});

describe("bundleOfferProblem", () => {
  it("accepts ordinary offers", () => {
    expect(bundleOfferProblem(offer())).toBeNull();
    expect(bundleOfferProblem(offer({ discountType: "FLAT", discountValue: 200 }))).toBeNull();
    expect(bundleOfferProblem(offer({ minItems: 3, maxItems: 5 }))).toBeNull();
  });

  it("caps a percentage at 90", () => {
    expect(bundleOfferProblem(offer({ discountValue: 90 }))).toBeNull();
    expect(bundleOfferProblem(offer({ discountValue: 100 }))).toMatch(/at most 90%/);
  });

  it("refuses a flat amount that would make the cheapest bundle free", () => {
    // Cheapest two: 2 × ₹499 = ₹998.
    expect(bundleOfferProblem(offer({ discountType: "FLAT", discountValue: 997 }))).toBeNull();
    expect(bundleOfferProblem(offer({ discountType: "FLAT", discountValue: 998 }))).toMatch(/free/);
  });

  it("checks item counts, products and the value", () => {
    expect(bundleOfferProblem(offer({ minItems: 1 }))).toMatch(/at least 2/);
    expect(bundleOfferProblem(offer({ minItems: 3, maxItems: 2 }))).toMatch(/fewer than the fewest/);
    expect(bundleOfferProblem(offer({ eligiblePricesPaise: [49900] }))).toMatch(/two eligible/);
    expect(bundleOfferProblem(offer({ discountValue: 0 }))).toMatch(/above zero/);
    expect(bundleOfferProblem(offer({ discountType: "BOGO" }))).toMatch(/percentage or a flat/);
  });
});
