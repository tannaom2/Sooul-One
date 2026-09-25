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
  /** Current selling price of each eligible product, in paise. */
  readonly eligiblePricesPaise: readonly number[];
}

/** Why this offer can't be saved, in words for staff, or null when it's fine. */
export function bundleOfferProblem(offer: BundleOffer): string | null {
  const { discountType, discountValue, minItems, maxItems, eligiblePricesPaise } = offer;
  if (!Number.isInteger(minItems) || minItems < 2) return "A bundle needs at least 2 items.";
  if (maxItems != null && (!Number.isInteger(maxItems) || maxItems < minItems)) {
    return "The most items can't be fewer than the fewest.";
  }
  if (eligiblePricesPaise.length < 2) return "Pick at least two eligible products — a bundle needs something to combine.";
  if (!Number.isFinite(discountValue) || discountValue <= 0) return "Set a discount above zero.";

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
