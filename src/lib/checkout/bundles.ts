/**
 * Bundle / combination pricing.
 *
 * A bundle names a set of eligible products and a rule: buy at least
 * `minItems` DIFFERENT eligible products together and get `discountValue` off
 * them. A "fixed combo" is the same rule with `minItems` equal to the number
 * of eligible products (every product required).
 *
 * The discount is per complete set, one unit of each product in it, the way
 * peers price combos and boxes (Farmley's pairs, Power Gummies' box tiers):
 *   - A set takes one unit of every eligible product still in the basket, up
 *     to `maxItems` (the highest-value ones), and needs at least `minItems`.
 *   - Sets repeat while enough different products have units left, so two
 *     of A and two of B make two sets.
 *   - Extra units that don't complete a set pay full price. Twenty jars of A
 *     plus one of B is one set (A + B), not a 15% discount on 21 jars; a
 *     single cheap add-on can't turn a combo into a bulk discount.
 *
 * Savings are whole rupees, rounded down: a percentage can come out at
 * ₹113.76, and a combo reads as "₹835", not "₹834.24". Rounding down means
 * the seller never gives away more than the rule says.
 *
 * Pure: rules and lines (list price per unit, units) go in; per-line units
 * claimed and discounts come out. Priced off MRP; quote.ts then gives each
 * unit the better of its own sale price or the combo price, never both.
 *
 * Overlap: a product can be eligible for several bundles. Each cart line is
 * claimed by at most one bundle, so offers never stack on the same item. The
 * bundle that saves the shopper most is applied first and claims its lines;
 * the rest are then evaluated against whatever is left.
 */

import { applyDiscount, distributeDiscount, type DiscountType, type Paise } from "../money";

export interface BundleRule {
  readonly id: string;
  readonly name: string;
  /** Distinct eligible products needed for a set. */
  readonly minItems: number;
  /** If set, a set takes at most this many (highest-value) products. */
  readonly maxItems?: number | null;
  readonly discountType: DiscountType;
  readonly discountValue: number;
  readonly eligibleProductIds: readonly string[];
}

export interface BundleLineInput {
  readonly productId: string;
  /** List (MRP-based) price of one unit. */
  readonly unitPaise: Paise;
  /** Units that can actually ship; 0 means the line is out of play. */
  readonly quantity: number;
}

export interface AppliedBundle {
  readonly id: string;
  readonly name: string;
  readonly discountPaise: Paise;
  readonly productIds: readonly string[];
  /** Complete sets the discount was applied to. */
  readonly sets: number;
  /**
   * The products in each set when every set has the same ones (always, for a
   * fixed combo); null when a mix-and-match offer made sets of different
   * products. Lets the basket offer "one more kit" as a single step.
   */
  readonly perSet: readonly string[] | null;
}

export interface BundleResult {
  /** Discount per input line (list basis), same order as the input. */
  readonly perLinePaise: readonly Paise[];
  /** Units of each line that formed part of a set (the rest pay full price). */
  readonly perLineUnits: readonly number[];
  /** Name of the bundle that claimed each line, or null. */
  readonly perLineBundle: readonly (string | null)[];
  /** Id of the bundle that claimed each line, or null. */
  readonly perLineBundleId: readonly (string | null)[];
  readonly applied: readonly AppliedBundle[];
  readonly totalPaise: Paise;
}

interface Candidate {
  readonly rule: BundleRule;
  readonly lineIndexes: number[];
  readonly unitsByLine: Map<number, number>;
  readonly discountByLine: Map<number, Paise>;
  readonly discountPaise: Paise;
  readonly sets: number;
  readonly perSet: readonly string[] | null;
}

/** Complete sets this rule makes from the unclaimed lines, and what each line saves. */
function evaluate(rule: BundleRule, lines: readonly BundleLineInput[], claimed: ReadonlySet<number>): Candidate | null {
  const eligible = new Set(rule.eligibleProductIds);
  const minItems = Math.max(rule.minItems, 1);
  const cap = rule.maxItems && rule.maxItems > 0 ? rule.maxItems : Infinity;

  // One line per product (the first), so "different products" means different products.
  const byProduct = new Map<string, number>();
  lines.forEach((line, index) => {
    if (claimed.has(index) || line.quantity <= 0 || line.unitPaise <= 0 || !eligible.has(line.productId)) return;
    if (!byProduct.has(line.productId)) byProduct.set(line.productId, index);
  });
  const remaining = new Map([...byProduct.values()].map((i) => [i, lines[i].quantity]));

  const unitsByLine = new Map<number, number>();
  const discountByLine = new Map<number, Paise>();
  let discountPaise = 0;
  let sets = 0;
  const makeups = new Set<string>();
  let firstSet: string[] = [];

  for (;;) {
    // Highest-value products first (ties: basket order), up to the cap.
    const members = [...remaining.entries()]
      .filter(([, left]) => left > 0)
      .map(([i]) => i)
      .sort((a, b) => lines[b].unitPaise - lines[a].unitPaise || a - b)
      .slice(0, cap);
    if (members.length < minItems) break;

    const setValues = members.map((i) => lines[i].unitPaise);
    const { discountPaise: exactDiscount } = applyDiscount(
      setValues.reduce((sum, v) => sum + v, 0),
      rule.discountType,
      rule.discountValue,
    );
    const setDiscount = Math.floor(exactDiscount / 100) * 100; // whole rupees, down
    if (setDiscount <= 0) break;

    const products = members.map((i) => lines[i].productId);
    if (sets === 0) firstSet = products;
    makeups.add([...products].sort().join(","));

    const shares = distributeDiscount(setValues, setDiscount);
    members.forEach((i, n) => {
      remaining.set(i, remaining.get(i)! - 1);
      unitsByLine.set(i, (unitsByLine.get(i) ?? 0) + 1);
      discountByLine.set(i, (discountByLine.get(i) ?? 0) + shares[n]);
    });
    discountPaise += setDiscount;
    sets += 1;
  }

  if (sets === 0) return null;
  return {
    rule,
    lineIndexes: [...unitsByLine.keys()].sort((a, b) => a - b),
    unitsByLine,
    discountByLine,
    discountPaise,
    sets,
    perSet: makeups.size === 1 ? firstSet : null,
  };
}

export function applyBundles(lines: readonly BundleLineInput[], rules: readonly BundleRule[]): BundleResult {
  const perLinePaise: Paise[] = lines.map(() => 0);
  const perLineUnits: number[] = lines.map(() => 0);
  const perLineBundle: (string | null)[] = lines.map(() => null);
  const perLineBundleId: (string | null)[] = lines.map(() => null);
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

    for (const i of best.lineIndexes) {
      perLinePaise[i] = best.discountByLine.get(i) ?? 0;
      perLineUnits[i] = best.unitsByLine.get(i) ?? 0;
      perLineBundle[i] = best.rule.name;
      perLineBundleId[i] = best.rule.id;
      claimed.add(i);
    }
    used.add(best.rule.id);
    applied.push({
      id: best.rule.id,
      name: best.rule.name,
      discountPaise: best.discountPaise,
      productIds: best.lineIndexes.map((i) => lines[i].productId),
      sets: best.sets,
      perSet: best.perSet,
    });
  }

  return { perLinePaise, perLineUnits, perLineBundle, perLineBundleId, applied, totalPaise: perLinePaise.reduce((sum, p) => sum + p, 0) };
}

/**
 * What one set of this bundle costs, for showing on the storefront: the list
 * price of one unit of each product, the combo price, and the saving. Uses
 * the same arithmetic the basket uses, so a product page can't promise a
 * price checkout won't honour. `unitSalePaise` is what each unit sells for
 * today; the combo only saves the difference where it beats that.
 */
export function comboPrice(
  rule: BundleRule,
  items: readonly { productId: string; unitListPaise: Paise; unitSalePaise: Paise }[],
): { listPaise: Paise; salePaise: Paise; comboPaise: Paise; savingPaise: Paise } | null {
  const result = applyBundles(
    items.map((i) => ({ productId: i.productId, unitPaise: i.unitListPaise, quantity: 1 })),
    [rule],
  );
  if (result.applied.length === 0) return null;
  let listPaise = 0;
  let salePaise = 0;
  let comboPaise = 0;
  items.forEach((item, i) => {
    listPaise += item.unitListPaise;
    salePaise += item.unitSalePaise;
    // Better of the two, never both (as quote.ts does per unit).
    comboPaise += result.perLineUnits[i] > 0 ? Math.min(item.unitSalePaise, item.unitListPaise - result.perLinePaise[i]) : item.unitSalePaise;
  });
  return { listPaise, salePaise, comboPaise, savingPaise: salePaise - comboPaise };
}
