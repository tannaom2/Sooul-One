import type { Paise } from "../money";
import type { Quote } from "./quote";

/**
 * Combos as the shopper thinks of them: "2 × Growing-Up Kit, ₹1,670, you save
 * ₹226", instead of a discount split across lines. The split stays on the
 * invoice, where GST needs it; the basket shows kits.
 *
 * Pure, and read straight off the quote (which units form sets, and what each
 * line saved), so a kit's price is exactly what checkout charges.
 */

export interface KitMember {
  readonly productId: string;
  readonly name: string;
  /** Units of this product inside the kits. */
  readonly units: number;
}

export interface Kit {
  readonly bundleId: string;
  readonly name: string;
  readonly sets: number;
  /** Every kit holds the same products, one of each. */
  readonly uniform: boolean;
  /** Products of the last kit formed: one of each is what "− kit" removes and "+ kit" adds. */
  readonly lastSet: readonly string[];
  readonly members: readonly KitMember[];
  /** What the kits' units cost at their usual prices. */
  readonly salePaise: Paise;
  readonly kitPaise: Paise;
  readonly savingPaise: Paise;
  /**
   * Products that would complete one more kit, when the basket already holds
   * extra units of the others (uniform kits only; empty otherwise).
   */
  readonly completeWith: readonly { productId: string; name: string }[];
  /** What one more kit would save. */
  readonly nextKitSavingPaise: Paise;
}

export function groupKits(quote: Pick<Quote, "lines" | "appliedBundles">): Kit[] {
  const kits: Kit[] = [];
  for (const bundle of quote.appliedBundles) {
    const lines = quote.lines.filter((l) => l.bundleId === bundle.id && l.bundleUnits > 0);
    const savingPaise = lines.reduce((sum, l) => sum + l.bundleDiscountPaise, 0);
    // A combo that saved nothing (every unit's own sale price was lower) isn't shown as a kit.
    if (lines.length === 0 || savingPaise <= 0) continue;

    const unit = (l: (typeof lines)[number]) => (l.quantityAvailable > 0 ? l.grossPaise / l.quantityAvailable : 0);
    const salePaise = Math.round(lines.reduce((sum, l) => sum + unit(l) * l.bundleUnits, 0));
    const uniform = bundle.perSet !== null && lines.every((l) => l.bundleUnits === bundle.sets);

    // One more kit: some products already have spare units, the rest have
    // none, and nothing is short of stock (adding more wouldn't help then).
    const spare = (l: (typeof lines)[number]) => l.quantityAvailable - l.bundleUnits;
    const canGrow = uniform && lines.every((l) => l.status === "OK") && lines.some((l) => spare(l) > 0);
    const completeWith = canGrow ? lines.filter((l) => spare(l) === 0).map((l) => ({ productId: l.productId, name: l.name })) : [];

    kits.push({
      bundleId: bundle.id,
      name: bundle.name,
      sets: bundle.sets,
      uniform,
      lastSet: bundle.lastSet,
      members: lines.map((l) => ({ productId: l.productId, name: l.name, units: l.bundleUnits })),
      salePaise,
      kitPaise: salePaise - savingPaise,
      savingPaise,
      completeWith,
      nextKitSavingPaise: Math.floor(savingPaise / bundle.sets),
    });
  }
  return kits;
}
