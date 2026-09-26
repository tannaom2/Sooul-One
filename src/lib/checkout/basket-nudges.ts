/**
 * The two basket prompts: progress to free delivery, and the nearest bundle
 * offer the shopper is one or two products away from.
 *
 * Both are suggestions shown to the shopper, never actions taken for them
 * (adding items on their behalf is "basket sneaking" under India's CCPA
 * dark-pattern rules). Pure, so they're tested directly.
 */

import { applyDiscount, type DiscountType, type Paise } from "../money";
import { applyBundles, type BundleLineInput, type BundleRule } from "./bundles";

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
  return rankOfferNudges(shippableProductIds, rules, appliedBundleIds, unitPriceById, maxMissing)[0] ?? null;
}

/**
 * Every bundle within reach, best first (the order nextOfferNudge picks
 * from), so the caller can fall back to the next one when settleNudge or
 * stock rules the first out.
 */
export function rankOfferNudges(
  shippableProductIds: readonly string[],
  rules: readonly BundleRule[],
  appliedBundleIds: readonly string[],
  unitPriceById: ReadonlyMap<string, Paise> = new Map(),
  maxMissing = 2,
): OfferNudge[] {
  const inBasket = new Set(shippableProductIds);
  const applied = new Set(appliedBundleIds);
  const found: OfferNudge[] = [];

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
    found.push(candidate);
  }
  // Stable, so equal candidates keep rule order.
  return found.sort((a, b) => a.missing - b.missing || b.savingPaise - a.savingPaise);
}

/**
 * Check a nudge against the real engine before showing it. Counting products
 * isn't enough: a product already in one kit can't also make another (each
 * line joins one bundle), and a suggested product may count towards a bigger
 * offer the shopper already has. So this adds the suggestion to the basket,
 * runs applyBundles, and keeps the nudge only if the saving really grows
 * through that same offer, with the saving it really adds. Suggestions that
 * wouldn't unlock it are dropped. Null when nothing would.
 *
 * `lines` are the basket as applyBundles takes them (list price, units that
 * can ship); `listPriceById` gives list prices for the suggested products.
 */
export function settleNudge(
  nudge: OfferNudge,
  lines: readonly BundleLineInput[],
  rules: readonly BundleRule[],
  listPriceById: ReadonlyMap<string, Paise>,
): OfferNudge | null {
  const before = applyBundles(lines, rules);
  const savedBy = (r: ReturnType<typeof applyBundles>, id: string) => r.applied.find((b) => b.id === id)?.discountPaise ?? 0;

  // Adding these: does the total saving grow, and does the nudged offer grow with it?
  const gain = (ids: readonly string[]) => {
    const after = applyBundles(
      [...lines, ...ids.map((id) => ({ productId: id, unitPaise: listPriceById.get(id) ?? 0, quantity: 1 }))],
      rules,
    );
    const total = after.totalPaise - before.totalPaise;
    return total > 0 && savedBy(after, nudge.bundleId) > savedBy(before, nudge.bundleId) ? total : 0;
  };

  if (nudge.missing === 1) {
    const works = nudge.suggestProductIds.filter((id) => gain([id]) > 0);
    if (works.length === 0) return null;
    return { ...nudge, suggestProductIds: works, savingPaise: gain([works[0]]) };
  }
  const saving = gain(nudge.suggestProductIds.slice(0, nudge.missing));
  return saving > 0 ? { ...nudge, savingPaise: saving } : null;
}
