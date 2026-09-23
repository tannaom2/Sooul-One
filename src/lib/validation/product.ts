/**
 * Regulatory-type-aware product validation — build prompt Sections 7.5 and 8.5.
 *
 * The brief is explicit about the shape of this: "Don't build one generic form
 * with every field optional — that's how a mandatory allergen field quietly
 * ships blank." So the schema is a discriminated union on `regulatoryType`
 * rather than one wide object with optional branches. A PACKAGED_FOOD product
 * that omits its nutrition table is not a valid product, and the type system
 * should say so at the boundary rather than the reviewer catching it later.
 *
 * This module is the single source of truth for both the admin API route and
 * the client form, so the two cannot drift apart.
 */

import { z } from "zod";
import { lintSupplementCopy } from "../compliance/claims";
import { assessShippability } from "../compliance/shelf-life";

/** Money arrives from the form as a string to avoid float drift. */
const rupees = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 249 or 249.50");

const slug = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and hyphens only");

/** Fields every product carries, whatever its regulatory type. */
const baseProduct = z.object({
  sku: z.string().min(1, "SKU is required").max(64),
  name: z.string().min(1, "Name is required").max(200),
  slug,
  brandId: z.string().min(1),
  categoryId: z.string().min(1),
  shortDescription: z.string().min(1, "Short description is required").max(300),
  description: z.string().min(1, "Description is required"),
  basePrice: rupees,
  compareAtPrice: rupees.optional(),
  /** Percentage-off promotion. `basePrice` stays the undiscounted price. */
  discountActive: z.boolean().default(false),
  discountPercent: z.number().gt(0, "Enter a percentage above 0").lt(100, "Must be below 100").optional(),
  hsnCode: z.string().regex(/^\d{4,8}$/, "HSN code is 4–8 digits").optional(),
  taxRatePercent: z.number().min(0).max(28),
  stockQuantity: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0),
  weightGrams: z.number().int().positive().optional(),
  availableInRetail: z.boolean(),
  retailOnly: z.boolean(),

  /**
   * Required for every type, not just food. The veg/non-veg mark is mandatory
   * on packaged goods generally, and for gummies it turns on gelatin vs.
   * pectin — an unresolved formulation fact (Section 14), which is exactly why
   * this has no default. A default here would silently assert something nobody
   * has confirmed.
   */
  isVeg: z.boolean({ message: "Confirm whether this product is vegetarian" }),

  /**
   * Required for every type, including supplements.
   *
   * The brief scoped shelf life to packaged food. Health supplements are food
   * products under the FSS Act, so the delivery rule reaches them, and without
   * this figure the checkout falls back to expiry-only checking — which sells
   * stock the rule would refuse. Requiring it here closes that gap at source.
   */
  shelfLifeDays: z
    .number()
    .int()
    .positive("Shelf life is required and drives the delivery-eligibility rule"),

  allergens: z.array(z.string().min(1)),
});

const nutritionFacts = z.object(
  {
    energyKcal: z.number().min(0),
    proteinG: z.number().min(0),
    carbohydrateG: z.number().min(0),
    totalSugarsG: z.number().min(0),
    totalFatG: z.number().min(0),
    saturatedFatG: z.number().min(0),
    transFatG: z.number().min(0),
    sodiumMg: z.number().min(0),
    fibreG: z.number().min(0).optional(),
    servingSizeG: z.number().positive(),
  },
  { message: "The full nutrition panel is required for packaged food" },
);

const supplementFactRow = z.object({
  ingredient: z.string().min(1),
  amountPerServing: z.string().min(1),
  percentRDA: z.number().min(0).nullable(),
});

/**
 * Note on `allergens` (declared on the base): empty is allowed but the array
 * must be present. The distinction matters — "no allergens" is a declaration
 * the owner has made, whereas an absent field is one nobody has considered.
 */
const packagedFood = baseProduct.extend({
  regulatoryType: z.literal("PACKAGED_FOOD"),
  nutritionFacts,
});

const healthSupplement = baseProduct.extend({
  regulatoryType: z.literal("HEALTH_SUPPLEMENT"),
  servingsPerContainer: z.number().int().positive("Servings per container is required"),
  dosageGuidance: z.string().min(1, "Dosage guidance is required"),
  supplementFacts: z
    .array(supplementFactRow)
    .min(1, "At least one supplement-facts row is required"),
  /**
   * Section 7.5's checkbox. Not a rubber stamp — the product cannot be
   * activated without it, and it is cleared whenever the description changes
   * so that an edit after approval cannot inherit the old sign-off.
   */
  complianceReviewConfirmed: z.boolean(),
  isActive: z.boolean(),
});

const beverage = baseProduct.extend({
  regulatoryType: z.literal("BEVERAGE"),
  nutritionFacts,
});

const DO_NOT_EXCEED = /\b(do not exceed|not to exceed|don'?t exceed|no more than)\b/i;

/**
 * Terms the beverage line may not use (Decision #6, Section 8.5).
 *
 * FSSAI directed manufacturers off the "energy drink" designation; the lawful
 * category name is "caffeinated beverage". Catching this at data entry is the
 * difference between renaming a draft and reprinting packaging.
 */
const PROHIBITED_BEVERAGE_TERMS = [
  { term: /\benergy drinks?\b/i, reason: 'FSSAI directed this designation off product naming and marketing. Use "caffeinated beverage".' },
  { term: /\bboosts? (your )?energy\b/i, reason: "Functional energy claims were specifically named in the directive." },
  { term: /\bvitali[sz]es?\b/i, reason: "Named in the directive as a misleading functional claim." },
];

export const productInputSchema = z
  .discriminatedUnion("regulatoryType", [packagedFood, healthSupplement, beverage])
  .superRefine((input, ctx) => {
    // --- Supplements: dosage must carry do-not-exceed language -------------
    if (input.regulatoryType === "HEALTH_SUPPLEMENT") {
      if (!DO_NOT_EXCEED.test(input.dosageGuidance)) {
        ctx.addIssue({
          code: "custom",
          path: ["dosageGuidance"],
          message:
            'Dosage guidance must carry explicit do-not-exceed wording, e.g. "1 gummy daily. Do not exceed the recommended dose."',
        });
      }

      // --- Supplements: copy must clear the claims linter ------------------
      for (const field of ["description", "shortDescription"] as const) {
        const result = lintSupplementCopy(input[field]);
        for (const finding of result.findings) {
          if (finding.severity !== "BLOCK") continue;
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `"${finding.matchedText}" reads as a therapeutic claim. ${finding.explanation}${
              finding.suggestion ? ` Consider "${finding.suggestion}".` : ""
            }`,
          });
        }
      }

      // --- Supplements: no going live without sign-off ----------------------
      if (input.isActive && !input.complianceReviewConfirmed) {
        ctx.addIssue({
          code: "custom",
          path: ["complianceReviewConfirmed"],
          message:
            "Confirm the claims review before publishing a health supplement. Saving as a draft does not require it.",
        });
      }
    }

    // --- Beverages: the naming prohibition ---------------------------------
    if (input.regulatoryType === "BEVERAGE") {
      for (const field of ["name", "shortDescription", "description"] as const) {
        for (const { term, reason } of PROHIBITED_BEVERAGE_TERMS) {
          const match = term.exec(input[field]);
          if (match) {
            ctx.addIssue({
              code: "custom",
              path: [field],
              message: `"${match[0]}" cannot be used. ${reason}`,
            });
          }
        }
      }
    }

    // --- Is this SKU shippable at all, whatever its type? -------------------
    if (!input.retailOnly) {
      const assessment = assessShippability(input.shelfLifeDays);
      if (!assessment.isShippable) {
        ctx.addIssue({
          code: "custom",
          path: ["shelfLifeDays"],
          message: assessment.warning!,
        });
      }
    }

    // --- Cross-field sanity -------------------------------------------------
    if (input.compareAtPrice && Number(input.compareAtPrice) <= Number(input.basePrice)) {
      ctx.addIssue({
        code: "custom",
        path: ["compareAtPrice"],
        message: "Compare-at price must be higher than the selling price, or left blank.",
      });
    }

    if (input.discountActive && input.discountPercent === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["discountPercent"],
        message: "Enter the discount percentage, or switch the discount off.",
      });
    }

    if (input.retailOnly && !input.availableInRetail) {
      ctx.addIssue({
        code: "custom",
        path: ["availableInRetail"],
        message: "A retail-only product must be marked as available in retail.",
      });
    }
  });

export type ProductInput = z.infer<typeof productInputSchema>;

/** Field names the admin form should render for a given regulatory type. */
export function requiredFieldsFor(type: ProductInput["regulatoryType"]): readonly string[] {
  const shared = [
    "sku", "name", "slug", "brandId", "categoryId", "shortDescription",
    "description", "basePrice", "isVeg", "shelfLifeDays", "allergens",
  ];
  switch (type) {
    case "PACKAGED_FOOD":
      return [...shared, "nutritionFacts"];
    case "HEALTH_SUPPLEMENT":
      return [...shared, "servingsPerContainer", "dosageGuidance", "supplementFacts", "complianceReviewConfirmed"];
    case "BEVERAGE":
      return [...shared, "nutritionFacts"];
  }
}
