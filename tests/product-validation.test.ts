import { describe, expect, it } from "vitest";
import { productInputSchema, requiredFieldsFor } from "../src/lib/validation/product";

const base = {
  sku: "TTS-NAM-001",
  name: "Roasted Masala Chana",
  slug: "roasted-masala-chana",
  brandId: "brand_true_store",
  categoryId: "cat_namkeen",
  shortDescription: "Slow-roasted, never fried.",
  description: "A everyday namkeen roasted in small batches.",
  basePrice: "199",
  taxRatePercent: 12,
  stockQuantity: 100,
  lowStockThreshold: 10,
  availableInRetail: true,
  retailOnly: false,
  isVeg: true,
};

const nutrition = {
  energyKcal: 410,
  proteinG: 19,
  carbohydrateG: 52,
  totalSugarsG: 3,
  totalFatG: 12,
  saturatedFatG: 2,
  transFatG: 0,
  sodiumMg: 480,
  fibreG: 15,
  servingSizeG: 30,
};

const validFood = {
  ...base,
  regulatoryType: "PACKAGED_FOOD" as const,
  shelfLifeDays: 180,
  allergens: ["peanuts"],
  nutritionFacts: nutrition,
};

const validSupplement = {
  ...base,
  sku: "WA-BIO-001",
  slug: "biotin-gummies",
  name: "Biotin Gummies",
  shortDescription: "A daily gummy that supports hair strength.",
  description: "Supports healthy hair and helps maintain normal skin.",
  regulatoryType: "HEALTH_SUPPLEMENT" as const,
  shelfLifeDays: 730,
  servingsPerContainer: 30,
  dosageGuidance: "1 gummy daily. Do not exceed the recommended dose.",
  supplementFacts: [{ ingredient: "Biotin", amountPerServing: "5000 mcg", percentRDA: 100 }],
  allergens: [],
  complianceReviewConfirmed: true,
  isActive: true,
};

/** Collect the field paths a failed parse complained about. */
function errorPaths(input: unknown): string[] {
  const result = productInputSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((i) => i.path.join("."));
}

describe("the happy paths", () => {
  it("accepts a complete packaged-food product", () => {
    expect(productInputSchema.safeParse(validFood).success).toBe(true);
  });

  it("accepts a complete health supplement", () => {
    expect(productInputSchema.safeParse(validSupplement).success).toBe(true);
  });
});

describe("PACKAGED_FOOD mandatory fields", () => {
  it("rejects a product with no nutrition panel — the brief's stated failure mode", () => {
    const { nutritionFacts, ...withoutNutrition } = validFood;
    expect(errorPaths(withoutNutrition)).toContain("nutritionFacts");
  });

  it("rejects a partial nutrition panel", () => {
    const partial = { ...validFood, nutritionFacts: { energyKcal: 410, proteinG: 19 } };
    expect(productInputSchema.safeParse(partial).success).toBe(false);
  });

  it("rejects an absent allergen declaration while allowing an empty one", () => {
    const { allergens, ...withoutAllergens } = validFood;
    expect(errorPaths(withoutAllergens)).toContain("allergens");
    expect(productInputSchema.safeParse({ ...validFood, allergens: [] }).success).toBe(true);
  });

  it("requires shelf life, which drives the delivery rule", () => {
    const { shelfLifeDays, ...withoutShelfLife } = validFood;
    expect(errorPaths(withoutShelfLife)).toContain("shelfLifeDays");
  });

  it("does not demand supplement fields of a food product", () => {
    expect(errorPaths(validFood)).toHaveLength(0);
  });
});

describe("HEALTH_SUPPLEMENT mandatory fields", () => {
  it("requires supplement facts", () => {
    const { supplementFacts, ...without } = validSupplement;
    expect(errorPaths(without)).toContain("supplementFacts");
  });

  it("requires dosage guidance to carry do-not-exceed wording", () => {
    const weak = { ...validSupplement, dosageGuidance: "Take 1 gummy daily." };
    expect(errorPaths(weak)).toContain("dosageGuidance");
  });

  it("does not demand a nutrition panel of a supplement", () => {
    expect(errorPaths(validSupplement)).toHaveLength(0);
  });

  it("requires a shelf life — supplements are food products under the FSS Act", () => {
    // The brief scoped shelf life to packaged food. Without it here, checkout
    // falls back to expiry-only and sells stock the delivery rule would refuse.
    const { shelfLifeDays, ...without } = validSupplement;
    expect(errorPaths(without)).toContain("shelfLifeDays");
  });

  it("rejects a supplement whose shelf life leaves no lawful shipping window", () => {
    const impossible = { ...validSupplement, shelfLifeDays: 45 };
    expect(errorPaths(impossible)).toContain("shelfLifeDays");
  });
});

describe("veg/non-veg, required for every type", () => {
  it("has no default — gelatin vs. pectin is unresolved and must not be assumed", () => {
    const { isVeg, ...without } = validSupplement;
    expect(errorPaths(without)).toContain("isVeg");
  });
});

describe("claims guardrails on supplement copy", () => {
  it("blocks a therapeutic claim in the description", () => {
    const bad = { ...validSupplement, description: "Cures hair fall in four weeks." };
    expect(errorPaths(bad)).toContain("description");
  });

  it("blocks a therapeutic claim in the short description too", () => {
    const bad = { ...validSupplement, shortDescription: "Treats thinning hair." };
    expect(errorPaths(bad)).toContain("shortDescription");
  });

  it("explains the problem and proposes a fix rather than just failing", () => {
    const bad = { ...validSupplement, description: "Treats dull skin." };
    const result = productInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.find((i) => i.path[0] === "description")!.message;
      expect(message).toMatch(/therapeutic claim/i);
      expect(message).toMatch(/supports/);
    }
  });

  it("does not apply the supplement linter to food copy", () => {
    // "cured" is ordinary food vocabulary.
    const food = { ...validFood, description: "Made with slow-cured spices." };
    expect(productInputSchema.safeParse(food).success).toBe(true);
  });

  it("will not publish a supplement without the compliance sign-off", () => {
    const unreviewed = { ...validSupplement, complianceReviewConfirmed: false, isActive: true };
    expect(errorPaths(unreviewed)).toContain("complianceReviewConfirmed");
  });

  it("permits saving an unreviewed supplement as a draft", () => {
    const draft = { ...validSupplement, complianceReviewConfirmed: false, isActive: false };
    expect(productInputSchema.safeParse(draft).success).toBe(true);
  });
});

describe("the beverage naming prohibition", () => {
  const beverage = {
    ...base,
    sku: "BEV-001",
    slug: "citrus-sparkle",
    regulatoryType: "BEVERAGE" as const,
    shelfLifeDays: 270,
    allergens: [],
    nutritionFacts: nutrition,
  };

  it("accepts a compliantly named beverage", () => {
    expect(productInputSchema.safeParse(beverage).success).toBe(true);
  });

  it('rejects "Energy Drink" in the product name', () => {
    const bad = { ...beverage, name: "SooulOne Energy Drink" };
    expect(errorPaths(bad)).toContain("name");
  });

  it('rejects "boosts energy" in the description', () => {
    const bad = { ...beverage, description: "A citrus drink that boosts energy all day." };
    expect(errorPaths(bad)).toContain("description");
  });

  it("explains why, so the author does not simply retry a synonym", () => {
    const result = productInputSchema.safeParse({ ...beverage, name: "Energy Drink" });
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/caffeinated beverage/i);
    }
  });
});

describe("shippability is checked at data entry", () => {
  it("rejects a shippable SKU whose shelf life leaves no lawful window", () => {
    const impossible = { ...validFood, shelfLifeDays: 45, retailOnly: false };
    expect(errorPaths(impossible)).toContain("shelfLifeDays");
  });

  it("permits the same shelf life when the SKU is retail-only", () => {
    const retail = { ...validFood, shelfLifeDays: 45, retailOnly: true, availableInRetail: true };
    expect(productInputSchema.safeParse(retail).success).toBe(true);
  });
});

describe("cross-field sanity", () => {
  it("rejects a compare-at price below the selling price", () => {
    expect(errorPaths({ ...validFood, compareAtPrice: "150" })).toContain("compareAtPrice");
  });

  it("rejects retail-only without retail availability", () => {
    const contradictory = { ...validFood, retailOnly: true, availableInRetail: false };
    expect(errorPaths(contradictory)).toContain("availableInRetail");
  });

  it("rejects a malformed price rather than coercing it", () => {
    expect(errorPaths({ ...validFood, basePrice: "199.999" })).toContain("basePrice");
  });

  it("rejects a non-slug slug", () => {
    expect(errorPaths({ ...validFood, slug: "Roasted Masala Chana" })).toContain("slug");
  });
});

describe("requiredFieldsFor", () => {
  it("returns a different field set per regulatory type", () => {
    const food = requiredFieldsFor("PACKAGED_FOOD");
    const supplement = requiredFieldsFor("HEALTH_SUPPLEMENT");

    expect(food).toContain("nutritionFacts");
    expect(food).not.toContain("supplementFacts");
    expect(supplement).toContain("supplementFacts");
    expect(supplement).not.toContain("nutritionFacts");
  });

  it("requires shelf life of every type, not just food", () => {
    for (const type of ["PACKAGED_FOOD", "HEALTH_SUPPLEMENT", "BEVERAGE"] as const) {
      expect(requiredFieldsFor(type)).toContain("shelfLifeDays");
    }
  });

  it("always includes the veg/non-veg declaration", () => {
    for (const type of ["PACKAGED_FOOD", "HEALTH_SUPPLEMENT", "BEVERAGE"] as const) {
      expect(requiredFieldsFor(type)).toContain("isVeg");
    }
  });
});
