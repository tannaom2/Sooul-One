import { describe, expect, it } from "vitest";
import { ageLabel, allergenLabel, sugarLabel } from "../src/lib/label-facts";

describe("sugarLabel", () => {
  it("uses the declared per-serving figure for supplements, including zero", () => {
    expect(sugarLabel({ regulatoryType: "HEALTH_SUPPLEMENT", sugarPerServingG: "1.50" })).toBe("1.5 g sugar per serving");
    expect(sugarLabel({ regulatoryType: "HEALTH_SUPPLEMENT", sugarPerServingG: 0 })).toBe("0 g sugar per serving");
  });

  it("says nothing when a supplement's figure wasn't declared", () => {
    expect(sugarLabel({ regulatoryType: "HEALTH_SUPPLEMENT", sugarPerServingG: null })).toBeNull();
  });

  it("uses the nutrition panel for food, with its serving size", () => {
    expect(
      sugarLabel({ regulatoryType: "PACKAGED_FOOD", nutritionFacts: { totalSugarsG: 3, servingSizeG: 30 } }),
    ).toBe("3 g sugar per 30 g");
    expect(sugarLabel({ regulatoryType: "PACKAGED_FOOD", nutritionFacts: null })).toBeNull();
  });
});

describe("ageLabel", () => {
  it("states a range, an open-ended minimum, or nothing", () => {
    expect(ageLabel(4, 12)).toBe("For ages 4–12");
    expect(ageLabel(4, null)).toBe("For ages 4+");
    expect(ageLabel(null, 12)).toBeNull();
  });
});

describe("allergenLabel", () => {
  it("distinguishes a declared empty list from an undeclared one", () => {
    expect(allergenLabel([])).toBe("No allergens declared");
    expect(allergenLabel(["peanuts", "milk"])).toBe("Contains peanuts, milk");
    expect(allergenLabel(undefined)).toBeNull();
  });
});
