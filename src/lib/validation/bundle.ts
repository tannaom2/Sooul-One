/**
 * Limits on a bundle offer (audit L7): staff could save a 100% discount, or a
 * flat one bigger than the products it applies to, with nothing to stop it.
 * Same ceiling as discount codes (src/lib/validation/coupon.ts): 90%.
 */
export const MAX_BUNDLE_PERCENT = 90;

export interface BundleOffer {
  readonly discountType: string;
  readonly discountValue: number;
  readonly minItems: number;
  readonly maxItems: number | null;
  /** Discount with one more product than the minimum (same type), or null. */
  readonly stepUpValue?: number | null;
  /** Current selling price of each eligible product, in paise. */
  readonly eligiblePricesPaise: readonly number[];
}

/** Why this offer can't be saved, in words for staff, or null when it's fine. */
export function bundleOfferProblem(offer: BundleOffer): string | null {
  const { discountType, discountValue, minItems, maxItems, eligiblePricesPaise } = offer;
  const stepUp = offer.stepUpValue ?? null;
  if (!Number.isInteger(minItems) || minItems < 2) return "A bundle needs at least 2 items.";
  if (maxItems != null && (!Number.isInteger(maxItems) || maxItems < minItems)) {
    return "The most items can't be fewer than the fewest.";
  }
  if (eligiblePricesPaise.length < 2) return "Pick at least two eligible products — a bundle needs something to combine.";
  if (!Number.isFinite(discountValue) || discountValue <= 0) return "Set a discount above zero.";
  if (stepUp != null) {
    if (!Number.isFinite(stepUp) || stepUp <= discountValue) {
      return "The discount with one more product has to be bigger than the main discount, or leave it empty.";
    }
    if (eligiblePricesPaise.length < minItems + 1) {
      return `A step-up needs at least ${minItems + 1} products in the bundle to choose from.`;
    }
    if (discountType === "PERCENTAGE") {
      if (stepUp > MAX_BUNDLE_PERCENT) return `A bundle can take at most ${MAX_BUNDLE_PERCENT}% off.`;
      if (stepUpAddOnPercent(minItems, discountValue, stepUp) >= MAX_BUNDLE_PERCENT) {
        return `That step-up would give the extra product ${stepUpAddOnPercent(minItems, discountValue, stepUp)}% off in effect. Lower it.`;
      }
    }
    if (discountType === "FLAT") {
      const cheapest = Math.min(...eligiblePricesPaise);
      if (Math.round(stepUp * 100) >= cheapest * (minItems + 1)) {
        return `₹${stepUp} off is at least the cheapest ${minItems + 1}-product kit it applies to. Lower it.`;
      }
    }
  }

  if (discountType === "PERCENTAGE") {
    return discountValue > MAX_BUNDLE_PERCENT ? `A bundle can take at most ${MAX_BUNDLE_PERCENT}% off.` : null;
  }
  if (discountType === "FLAT") {
    // The smallest basket the offer can apply to: the cheapest eligible
    // products, as many as the minimum (a product can be taken more than once).
    const cheapest = Math.min(...eligiblePricesPaise);
    const smallestBundlePaise = cheapest * minItems;
    const flatPaise = Math.round(discountValue * 100);
    if (flatPaise >= smallestBundlePaise) {
      return `₹${discountValue} off is at least the cheapest bundle it applies to (₹${(smallestBundlePaise / 100).toFixed(2)}), which would make it free. Lower the discount.`;
    }
    return null;
  }
  return "Choose a percentage or a flat amount off.";
}

/**
 * What the step-up really gives away on the extra product, as a percentage of
 * its price, with products of similar price: going from 2 products at 12% to
 * 3 at 15% takes 3 × 15 − 2 × 12 = 21% off the third. Shown to the owner
 * before saving, so the cost of the step-up is plain.
 */
export function stepUpAddOnPercent(minItems: number, discountPercent: number, stepUpPercent: number): number {
  return Math.round(((minItems + 1) * stepUpPercent - minItems * discountPercent) * 100) / 100;
}
