import { productAvailability, type AvailabilityInput } from "./checkout/availability";
import { SLOWEST_SERVED_ZONE, estimateDeliveryDate } from "./checkout/delivery";

/**
 * Stock as the admin should see it: the units held, and how many of them the
 * shop can actually send today. Some held units may be too close to their
 * best-before date to ship under the shelf-life rule, so "in stock" alone
 * overstates what's sellable. Uses the storefront's own availability rule and
 * delivery estimate, so admin and shop never disagree. Pure.
 */
export interface StockView {
  readonly held: number;
  readonly shippable: number;
  /** Held but too short-dated to ship. */
  readonly tooShortDated: number;
  /** Shippable stock at or below the product's reorder level. */
  readonly low: boolean;
}

export function stockView(product: AvailabilityInput, now: Date = new Date()): StockView {
  const held = product.batches.reduce((sum, b) => sum + Math.max(0, b.quantityRemaining), 0);
  const shippable = product.retailOnly ? 0 : productAvailability(product, estimateDeliveryDate(now, SLOWEST_SERVED_ZONE)).shippableUnits;
  return { held, shippable, tooShortDated: product.retailOnly ? 0 : held - shippable, low: shippable <= product.lowStockThreshold };
}
