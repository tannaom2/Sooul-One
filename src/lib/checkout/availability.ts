/**
 * What a product page or card may promise about stock.
 *
 * Built on `resolveAvailability` from quote.ts, the same rule the basket and
 * checkout enforce, so a page can never offer "Add to basket" for stock the
 * basket would then refuse. It asks: if someone ordered everything we hold,
 * how many units could we lawfully ship by the estimated delivery date?
 *
 * Pure (no database), so it's tested directly.
 */

import type { BatchLike } from "../compliance/shelf-life";
import { CUSTOMER_MESSAGES, resolveAvailability, type LineBlockReason } from "./quote";

export type AvailabilityState = "in" | "low" | "out" | "retail-only";

export interface ProductAvailability {
  readonly state: AvailabilityState;
  /** Units that could ship today, after the shelf-life rule. */
  readonly shippableUnits: number;
  /** Best-before of the pack we'd send first (FEFO), when batch-tracked. */
  readonly soonestBestBefore: Date | null;
  /** Why nothing can ship, in the basket's own words. Null when something can. */
  readonly message: string | null;
  readonly reason: LineBlockReason | null;
}

export interface AvailabilityInput {
  readonly regulatoryType: "PACKAGED_FOOD" | "HEALTH_SUPPLEMENT" | "BEVERAGE";
  readonly shelfLifeDays?: number | null;
  readonly stockQuantity: number;
  readonly lowStockThreshold: number;
  readonly retailOnly: boolean;
  readonly batches: readonly BatchLike[];
}

export function productAvailability(product: AvailabilityInput, estimatedDeliveryDate: Date): ProductAvailability {
  const held = product.batches.length
    ? product.batches.reduce((sum, b) => sum + Math.max(0, b.quantityRemaining), 0)
    : Math.max(0, product.stockQuantity);

  const result = resolveAvailability(
    {
      productId: "",
      name: "",
      regulatoryType: product.regulatoryType,
      unitPricePaise: 0,
      taxRatePercent: 0,
      // Ask for everything we hold; resolveAvailability needs at least 1.
      quantity: Math.max(1, held),
      shelfLifeDays: product.shelfLifeDays ?? undefined,
      batches: product.batches,
      stockQuantity: product.stockQuantity,
      retailOnly: product.retailOnly,
    },
    estimatedDeliveryDate,
  );

  const units = result.quantityAvailable;
  const soonestBestBefore = result.allocations[0]?.expiresOn ?? null;

  if (result.reason === "RETAIL_ONLY") {
    return { state: "retail-only", shippableUnits: 0, soonestBestBefore: null, message: CUSTOMER_MESSAGES.RETAIL_ONLY, reason: "RETAIL_ONLY" };
  }
  if (units === 0) {
    const reason = result.reason ?? "OUT_OF_STOCK";
    return { state: "out", shippableUnits: 0, soonestBestBefore: null, message: CUSTOMER_MESSAGES[reason], reason };
  }
  return {
    state: units <= product.lowStockThreshold ? "low" : "in",
    shippableUnits: units,
    soonestBestBefore,
    message: null,
    reason: null,
  };
}
