/**
 * The two basket prompts: progress to free delivery, and the nearest bundle
 * offer the shopper is one or two products away from.
 *
 * Both are suggestions shown to the shopper, never actions taken for them
 * (adding items on their behalf is "basket sneaking" under India's CCPA
 * dark-pattern rules). Pure, so they're tested directly.
 */

import { applyDiscount, type DiscountType, type Paise } from "../money";
import type { BundleRule } from "./bundles";

export interface FreeDeliveryProgress {
  readonly qualified: boolean;
  /** How much more (after discounts) unlocks free delivery; 0 once qualified. */
  readonly gapPaise: Paise;
  /** 0..1, for the progress bar. */
  readonly fraction: number;
}

/** `discountedSubtotalPaise` is what quote.ts compares to the threshold: items after all discounts. */
export function freeDeliveryProgress(discountedSubtotalPaise: Paise, freeAbovePaise: Paise): FreeDeliveryProgress {
  const qualified = discountedSubtotalPaise >= freeAbovePaise;
  return {
    qualified,
    gapPaise: qualified ? 0 : freeAbovePaise - discountedSubtotalPaise,
    fraction: freeAbovePaise > 0 ? Math.min(1, Math.max(0, discountedSubtotalPaise / freeAbovePaise)) : 1,
  };
}

export interface OfferNudge {
  readonly bundleId: string;
  readonly name: string;
  /** Distinct eligible products still needed. */
  readonly missing: number;
  readonly discountType: DiscountType;
  readonly discountValue: number;
  /** Eligible products not yet in the basket, cheapest first (the caller keeps only what can ship). */
  readonly suggestProductIds: readonly string[];
  /** Estimated saving on the smallest set that unlocks it, in paise (0 if prices unknown). */
  readonly savingPaise: Paise;
}

/**
 * The bundle the shopper is closest to unlocking: already holding at least
 * one eligible product, and at most `maxMissing` short. Nearest first; the
 * bigger saving in rupees breaks ties (comparing "15%" with "₹50" as plain
 * numbers would pick the wrong one). Bundles already applied are skipped.
 */
export function nextOfferNudge(
  shippableProductIds: readonly string[],
  rules: readonly BundleRule[],
  appliedBundleIds: readonly string[],
  unitPriceById: ReadonlyMap<string, Paise> = new Map(),
  maxMissing = 2,
): OfferNudge | null {
  const inBasket = new Set(shippableProductIds);
  const applied = new Set(appliedBundleIds);
  let best: OfferNudge | null = null;

  for (const rule of rules) {
    if (applied.has(rule.id)) continue;
    const have = rule.eligibleProductIds.filter((id) => inBasket.has(id)).length;
    const missing = Math.max(rule.minItems, 1) - have;
    if (have === 0 || missing < 1 || missing > maxMissing) continue;

    // Cheapest first: the likeliest way for the shopper to complete the set.
    const price = (id: string) => unitPriceById.get(id) ?? 0;
    const suggest = rule.eligibleProductIds.filter((id) => !inBasket.has(id)).sort((a, b) => price(a) - price(b));
    if (suggest.length < missing) continue; // not enough other products to ever unlock it

    const setValue =
      rule.eligibleProductIds.filter((id) => inBasket.has(id)).reduce((sum, id) => sum + price(id), 0) +
      suggest.slice(0, missing).reduce((sum, id) => sum + price(id), 0);
    const candidate: OfferNudge = {
      bundleId: rule.id,
      name: rule.name,
      missing,
      discountType: rule.discountType,
      discountValue: rule.discountValue,
      suggestProductIds: suggest,
      savingPaise: setValue > 0 ? applyDiscount(setValue, rule.discountType, rule.discountValue).discountPaise : 0,
    };
    if (
      !best ||
      candidate.missing < best.missing ||
      (candidate.missing === best.missing && candidate.savingPaise > best.savingPaise)
    ) {
      best = candidate;
    }
  }
  return best;
}
