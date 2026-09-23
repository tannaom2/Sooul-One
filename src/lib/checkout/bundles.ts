/**
 * Bundle / combination pricing.
 *
 * A bundle names a set of eligible products and a rule: buy at least `minItems`
 * DIFFERENT eligible products together and get `discountValue` off them. The
 * discount applies once per order to the lines that qualified, not per set —
 * "10% off a hamper" rather than "10% off every pair".
 *
 * Pure: rules and line totals go in, per-line discounts come out.
 *
 * Overlap: a product can be eligible for several bundles. Each cart line is
 * claimed by at most one bundle so offers never stack on the same item. The
 * bundle that saves the shopper most is applied first and claims its lines; the
 * rest are then evaluated against whatever is left.
 *
 * The discount is taken off each line's price AFTER any product-level discount,
 * and before the coupon and GST — see the order of operations in quote.ts.
 */

import { applyDiscount, distributeDiscount, type DiscountType, type Paise } from "../money";

export interface BundleRule {
  readonly id: string;
  readonly name: string;
  /** Distinct eligible products needed in the cart for the offer to apply. */
  readonly minItems: number;
  /** If set, only this many (highest-value) eligible products are discounted. */
  readonly maxItems?: number | null;
  readonly discountType: DiscountType;
  readonly discountValue: number;
  readonly eligibleProductIds: readonly string[];
}

export interface BundleLineInput {
  readonly productId: string;
  /** Payable gross for the line after product-level discount; 0 if it can't ship. */
  readonly grossPaise: Paise;
}

export interface AppliedBundle {
  readonly id: string;
  readonly name: string;
  readonly discountPaise: Paise;
  readonly productIds: readonly string[];
}

export interface BundleResult {
  /** Discount per input line, same order as the input. */
  readonly perLinePaise: readonly Paise[];
  /** Name of the bundle that discounted each line, or null. */
  readonly perLineBundle: readonly (string | null)[];
  readonly applied: readonly AppliedBundle[];
  readonly totalPaise: Paise;
}

interface Candidate {
  readonly rule: BundleRule;
  readonly lineIndexes: number[];
  readonly discountPaise: Paise;
}

function evaluate(
  rule: BundleRule,
  lines: readonly BundleLineInput[],
  claimed: ReadonlySet<number>,
): Candidate | null {
  const eligible = new Set(rule.eligibleProductIds);
  let indexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => !claimed.has(index) && line.grossPaise > 0 && eligible.has(line.productId))
    .map(({ index }) => index);

  const distinct = new Set(indexes.map((i) => lines[i].productId)).size;
  if (indexes.length === 0 || distinct < Math.max(rule.minItems, 1)) return null;

  // Cap at maxItems, keeping the highest-value lines (ties: cart order).
  if (rule.maxItems && indexes.length > rule.maxItems) {
    indexes = [...indexes]
      .sort((a, b) => lines[b].grossPaise - lines[a].grossPaise || a - b)
      .slice(0, rule.maxItems)
      .sort((a, b) => a - b);
  }

  const base = indexes.reduce((sum, i) => sum + lines[i].grossPaise, 0);
  const { discountPaise } = applyDiscount(base, rule.discountType, rule.discountValue);
  if (discountPaise <= 0) return null;

  return { rule, lineIndexes: indexes, discountPaise };
}

export function applyBundles(
  lines: readonly BundleLineInput[],
  rules: readonly BundleRule[],
): BundleResult {
  const perLinePaise: Paise[] = lines.map(() => 0);
  const perLineBundle: (string | null)[] = lines.map(() => null);
  const applied: AppliedBundle[] = [];
  const claimed = new Set<number>();
  const used = new Set<string>();

  for (;;) {
    let best: Candidate | null = null;
    for (const rule of rules) {
      if (used.has(rule.id)) continue;
      const candidate = evaluate(rule, lines, claimed);
      if (!candidate) continue;
      // Biggest saving wins; rule id breaks ties so the result is deterministic.
      if (
        !best ||
        candidate.discountPaise > best.discountPaise ||
        (candidate.discountPaise === best.discountPaise && rule.id < best.rule.id)
      ) {
        best = candidate;
      }
    }
    if (!best) break;

    const shares = distributeDiscount(
      best.lineIndexes.map((i) => lines[i].grossPaise),
      best.discountPaise,
    );
    best.lineIndexes.forEach((lineIndex, n) => {
      perLinePaise[lineIndex] = shares[n];
      perLineBundle[lineIndex] = best!.rule.name;
      claimed.add(lineIndex);
    });
    used.add(best.rule.id);
    applied.push({
      id: best.rule.id,
      name: best.rule.name,
      discountPaise: best.discountPaise,
      productIds: best.lineIndexes.map((i) => lines[i].productId),
    });
  }

  return {
    perLinePaise,
    perLineBundle,
    applied,
    totalPaise: perLinePaise.reduce((sum, p) => sum + p, 0),
  };
}
