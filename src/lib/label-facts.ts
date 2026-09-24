/**
 * Plain-language facts for the product page and cards, taken only from what
 * the owner declared on the label (validation/product.ts). Nothing here
 * infers or rounds a claim upward: if a figure wasn't declared, there is no
 * line for it. Pure, so it's tested directly.
 */

const grams = (n: number) => `${Number.isInteger(n) ? n : Math.round(n * 10) / 10} g`;

/** "1.5 g sugar per serving" (supplements) or "3 g sugar per 30 g" (food). */
export function sugarLabel(p: {
  regulatoryType: string;
  sugarPerServingG?: number | string | null;
  nutritionFacts?: { totalSugarsG?: number; servingSizeG?: number } | null;
}): string | null {
  if (p.regulatoryType === "HEALTH_SUPPLEMENT") {
    if (p.sugarPerServingG === null || p.sugarPerServingG === undefined || p.sugarPerServingG === "") return null;
    const n = Number(p.sugarPerServingG);
    return Number.isFinite(n) ? `${grams(n)} sugar per serving` : null;
  }
  const sugar = p.nutritionFacts?.totalSugarsG;
  const serving = p.nutritionFacts?.servingSizeG;
  if (typeof sugar !== "number" || typeof serving !== "number") return null;
  return `${grams(sugar)} sugar per ${grams(serving)}`;
}

/** "For ages 4–12", "For ages 4+", or null when no age was declared. */
export function ageLabel(from?: number | null, to?: number | null): string | null {
  if (from === null || from === undefined) return null;
  return to !== null && to !== undefined ? `For ages ${from}–${to}` : `For ages ${from}+`;
}

/** "No allergens declared" only when the owner declared an empty list. */
export function allergenLabel(allergens: readonly string[] | null | undefined): string | null {
  if (!allergens) return null;
  return allergens.length === 0 ? "No allergens declared" : `Contains ${allergens.join(", ")}`;
}

/**
 * Value per unit, so a shopper can compare packs of different sizes:
 * "₹30.00 per 100 g" for food with a declared pack weight, "₹16.63 per
 * serving" for supplements. Null when the size wasn't declared.
 */
export function unitPriceLabel(
  p: { regulatoryType: string; weightGrams?: number | null; servingsPerContainer?: number | null },
  pricePaise: number,
  format: (paise: number) => string,
): string | null {
  if (p.regulatoryType === "HEALTH_SUPPLEMENT") {
    return p.servingsPerContainer ? `${format(Math.round(pricePaise / p.servingsPerContainer))} per serving` : null;
  }
  return p.weightGrams ? `${format(Math.round((pricePaise * 100) / p.weightGrams))} per 100 g` : null;
}
