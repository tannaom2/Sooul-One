/**
 * Make Your Own Box: "pick any 3 for ₹999", across brands.
 *
 * Pure rules, unit-tested; the database side is src/server/boxes.ts.
 *
 * A box is something the shopper builds, so it's priced on its own items,
 * apart from the basket's other lines and kits (src/lib/checkout/quote.ts):
 *   - It needs exactly `size` items, no product more than `maxPerProduct`
 *     times, every item from the box's pool, and each section's minimum.
 *   - Complete, it costs `price`: the discount is what the items would cost
 *     at list price, less the box price, rounded down to whole rupees. A box
 *     never costs more than its items bought one by one; if they're cheaper
 *     than the box price, there's simply no box discount.
 *   - The discount is split across the items in proportion to their value,
 *     in whole rupees, so each invoice row carries its own taxable value at
 *     its own GST rate (the items stay separately priced, not one supply).
 *   - Incomplete, the items cost what they cost, and the box says what's missing.
 */

import { distributeDiscount, type Paise } from "../money";
import { GUMMY_BRANDS } from "../gummy-brands";

// --------------------------------------------------------------------------
// Box types: gummies or The True Store, never mixed.
// --------------------------------------------------------------------------

export type BoxKind = "GUMMIES" | "TRUE_STORE";

export const TRUE_STORE_SLUG = "the-true-store";

export const BOX_KINDS: readonly { kind: BoxKind; label: string }[] = [
  { kind: "GUMMIES", label: "Box of Gummies" },
  { kind: "TRUE_STORE", label: "The True Store" },
];

export const boxKindLabel = (kind: BoxKind) => BOX_KINDS.find((k) => k.kind === kind)?.label ?? kind;

/** The box type a brand's products can go in, or null for a brand no box takes. */
export function boxKindOf(brandSlug: string): BoxKind | null {
  if (brandSlug === TRUE_STORE_SLUG) return "TRUE_STORE";
  return GUMMY_BRANDS.some((b) => b.slug === brandSlug) ? "GUMMIES" : null;
}

/** "Snacks can't go in a Box of Gummies." */
export function wrongKindMessage(kind: BoxKind, productName: string): string {
  return kind === "GUMMIES"
    ? `${productName} is a snack, and this is a Box of Gummies.`
    : `${productName} is a gummy, and this is a True Store box.`;
}

export interface BoxSlotRule {
  readonly id: string;
  readonly label: string;
  readonly minPicks: number;
  readonly maxPicks: number | null;
}

export interface BoxRule {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly pricePaise: Paise;
  readonly maxPerProduct: number;
  readonly slots: readonly BoxSlotRule[];
  /** The pool: product id → the section it belongs to. */
  readonly eligible: ReadonlyMap<string, string>;
}

export interface BoxPick {
  readonly productId: string;
  readonly quantity: number;
}

export type BoxIssue =
  | { readonly kind: "TOO_FEW"; readonly missing: number }
  | { readonly kind: "TOO_MANY"; readonly extra: number }
  | { readonly kind: "PRODUCT_LIMIT"; readonly productId: string }
  | { readonly kind: "NOT_IN_BOX"; readonly productId: string }
  | { readonly kind: "SLOT_MIN"; readonly slotId: string; readonly label: string; readonly missing: number }
  | { readonly kind: "SLOT_MAX"; readonly slotId: string; readonly label: string; readonly extra: number };

export function boxIssues(rule: BoxRule, picks: readonly BoxPick[]): BoxIssue[] {
  const issues: BoxIssue[] = [];
  const units = picks.reduce((n, p) => n + Math.max(0, p.quantity), 0);
  if (units < rule.size) issues.push({ kind: "TOO_FEW", missing: rule.size - units });
  if (units > rule.size) issues.push({ kind: "TOO_MANY", extra: units - rule.size });

  const bySlot = new Map<string, number>();
  const byProduct = new Map<string, number>();
  for (const pick of picks) {
    byProduct.set(pick.productId, (byProduct.get(pick.productId) ?? 0) + pick.quantity);
    const slot = rule.eligible.get(pick.productId);
    if (!slot) {
      issues.push({ kind: "NOT_IN_BOX", productId: pick.productId });
      continue;
    }
    bySlot.set(slot, (bySlot.get(slot) ?? 0) + pick.quantity);
  }
  for (const [productId, n] of byProduct) {
    if (n > Math.max(1, rule.maxPerProduct)) issues.push({ kind: "PRODUCT_LIMIT", productId });
  }
  for (const slot of rule.slots) {
    const n = bySlot.get(slot.id) ?? 0;
    if (n < slot.minPicks) issues.push({ kind: "SLOT_MIN", slotId: slot.id, label: slot.label, missing: slot.minPicks - n });
    if (slot.maxPicks != null && n > slot.maxPicks) issues.push({ kind: "SLOT_MAX", slotId: slot.id, label: slot.label, extra: n - slot.maxPicks });
  }
  return issues;
}

/** In the shopper's words, for the basket and the box page. */
export function boxIssueMessage(issue: BoxIssue, nameOf: (productId: string) => string = () => "An item"): string {
  switch (issue.kind) {
    case "TOO_FEW":
      return `Pick ${issue.missing} more to complete your box.`;
    case "TOO_MANY":
      return `Your box has ${issue.extra} too many. Take ${issue.extra === 1 ? "one" : issue.extra} out.`;
    case "PRODUCT_LIMIT":
      return `${nameOf(issue.productId)} is in your box more times than allowed.`;
    case "NOT_IN_BOX":
      return `${nameOf(issue.productId)} is no longer part of this box. Swap it for another.`;
    case "SLOT_MIN":
      return `Pick ${issue.missing} more from “${issue.label}”.`;
    case "SLOT_MAX":
      return `Too many from “${issue.label}”: take ${issue.extra} out.`;
  }
}

export interface BoxPriceLine {
  /** List price of one unit. */
  readonly unitListPaise: Paise;
  readonly units: number;
}

/**
 * What a complete box saves, and each line's share, in whole rupees. Zero
 * (and zero shares) when the items cost less than the box price.
 */
export function priceBox(pricePaise: Paise, lines: readonly BoxPriceLine[]): { discountPaise: Paise; shares: Paise[] } {
  const values = lines.map((l) => l.unitListPaise * Math.max(0, l.units));
  const listTotal = values.reduce((sum, v) => sum + v, 0);
  const discountPaise = Math.max(0, Math.floor((listTotal - pricePaise) / 100) * 100);
  if (discountPaise === 0) return { discountPaise: 0, shares: lines.map(() => 0) };
  return { discountPaise, shares: distributeDiscount(values, discountPaise / 100).map((rupees) => rupees * 100) };
}

export interface PoolItemCost {
  readonly listPaise: Paise;
  /** Landed cost of one unit; null when the owner hasn't entered it. */
  readonly costPaise: Paise | null;
}

export interface BoxMargin {
  /** The cheapest and dearest box the pool allows, at list price. */
  readonly minValuePaise: Paise;
  readonly maxValuePaise: Paise;
  /** The box discount on those, as a percentage (0 when the box costs more). */
  readonly minDiscountPercent: number;
  readonly maxDiscountPercent: number;
  /** Box price less the landed cost of the dearest box: the worst case. Null if any cost is missing. */
  readonly worstMarginPaise: Paise | null;
  readonly itemsMissingCost: number;
  /** Too few products to fill a box at all. */
  readonly tooSmall: boolean;
}

/** For the box editor: what the box costs the seller at worst, before it goes live. */
export function boxMargin(pricePaise: Paise, size: number, maxPerProduct: number, pool: readonly PoolItemCost[]): BoxMargin {
  const perProduct = Math.max(1, maxPerProduct);
  const units = pool.flatMap((p) => Array.from({ length: perProduct }, () => p));
  const tooSmall = units.length < size;
  const byValue = [...units].sort((a, b) => b.listPaise - a.listPaise);
  const dearest = byValue.slice(0, size);
  const cheapest = byValue.slice(-size);
  const sum = (items: readonly PoolItemCost[]) => items.reduce((n, i) => n + i.listPaise, 0);
  const maxValuePaise = tooSmall ? 0 : sum(dearest);
  const minValuePaise = tooSmall ? 0 : sum(cheapest);
  const pct = (value: number) => (value > pricePaise ? Math.round(((value - pricePaise) / value) * 1000) / 10 : 0);
  // Worst margin: the box whose items cost SooulOne the most.
  const byCost = [...units].sort((a, b) => (b.costPaise ?? 0) - (a.costPaise ?? 0)).slice(0, size);
  const itemsMissingCost = pool.filter((p) => p.costPaise == null).length;
  return {
    minValuePaise,
    maxValuePaise,
    minDiscountPercent: pct(minValuePaise),
    maxDiscountPercent: pct(maxValuePaise),
    worstMarginPaise: tooSmall || itemsMissingCost > 0 ? null : pricePaise - byCost.reduce((n, i) => n + (i.costPaise ?? 0), 0),
    itemsMissingCost,
    tooSmall,
  };
}

// --------------------------------------------------------------------------
// The pool: which products a section's rule takes in.
// --------------------------------------------------------------------------

export interface SlotFilter {
  readonly brandIds: readonly string[];
  readonly categoryIds: readonly string[];
  readonly minPricePaise: Paise | null;
  readonly maxPricePaise: Paise | null;
  readonly mode: "ALL" | "CLEARANCE";
  readonly nearExpiryDays: number | null;
  readonly minDaysOfCover: number | null;
}

export interface ProductFacts {
  readonly brandId: string;
  readonly categoryId: string;
  readonly listPaise: Paise;
  /** Units that could ship today. */
  readonly shippableUnits: number;
  /** Days until the first batch we'd send can no longer ship; null when not batch-tracked. */
  readonly daysToCutoff: number | null;
  /** Units sold per day over the last 30 days. */
  readonly dailySales: number;
}

/** Whether the rule takes this product in, and why, in the owner's words. Null when it doesn't. */
export function slotTakes(filter: SlotFilter, p: ProductFacts): string | null {
  if (p.shippableUnits <= 0) return null;
  if (filter.brandIds.length > 0 && !filter.brandIds.includes(p.brandId)) return null;
  if (filter.categoryIds.length > 0 && !filter.categoryIds.includes(p.categoryId)) return null;
  if (filter.minPricePaise != null && p.listPaise < filter.minPricePaise) return null;
  if (filter.maxPricePaise != null && p.listPaise > filter.maxPricePaise) return null;
  if (filter.mode === "ALL") return "in the price range";

  const nearCutoff = filter.nearExpiryDays != null && p.daysToCutoff != null && p.daysToCutoff <= filter.nearExpiryDays;
  if (nearCutoff) return `near its shipping cut-off: ${p.daysToCutoff} days`;
  const cover = daysOfCover(p);
  if (filter.minDaysOfCover != null && cover >= filter.minDaysOfCover) {
    return Number.isFinite(cover) ? `slow-selling: ${Math.round(cover)} days of stock` : "slow-selling: no sales in 30 days";
  }
  return null;
}

/** How many days the shippable stock lasts at the recent sales rate. */
export function daysOfCover(p: Pick<ProductFacts, "shippableUnits" | "dailySales">): number {
  return p.dailySales > 0 ? p.shippableUnits / p.dailySales : Infinity;
}
