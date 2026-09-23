/**
 * Product-level discount pricing.
 *
 * `basePrice` stays the undiscounted (list) price. A product carries an on/off
 * toggle and a percentage; the price a shopper pays is derived here, in integer
 * paise, and nowhere else — the storefront, the cart quote and the invoice all
 * call this so they cannot disagree by a paisa.
 */

import type { Paise } from "./money";

export interface ProductDiscount {
  readonly active: boolean;
  readonly percent: number | null | undefined;
}

export interface ResolvedPrice {
  /** Undiscounted price. */
  readonly listPaise: Paise;
  /** What the shopper pays per unit. Equals `listPaise` when no discount applies. */
  readonly pricePaise: Paise;
  readonly discountPaise: Paise;
  /** The percentage actually applied, or null when none is. */
  readonly percentOff: number | null;
}

/** A discount only counts when switched on AND a sensible percentage is set. */
export function isDiscountLive(discount?: ProductDiscount | null): discount is ProductDiscount & { percent: number } {
  return Boolean(
    discount &&
      discount.active &&
      typeof discount.percent === "number" &&
      Number.isFinite(discount.percent) &&
      discount.percent > 0 &&
      discount.percent < 100,
  );
}

export function resolveUnitPrice(listPaise: Paise, discount?: ProductDiscount | null): ResolvedPrice {
  if (!Number.isInteger(listPaise) || listPaise < 0) {
    throw new RangeError(`listPaise must be a non-negative integer, received ${listPaise}`);
  }
  if (!isDiscountLive(discount)) {
    return { listPaise, pricePaise: listPaise, discountPaise: 0, percentOff: null };
  }
  const discountPaise = Math.round((listPaise * discount.percent) / 100);
  return {
    listPaise,
    pricePaise: listPaise - discountPaise,
    discountPaise,
    percentOff: discount.percent,
  };
}

/** "6" not "6.00", "6.5" not "6.50" — for badges like "6% off". */
export function formatPercent(percent: number): string {
  return String(Number(percent.toFixed(2)));
}
