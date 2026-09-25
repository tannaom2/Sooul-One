import type { FreeDeliveryProgress } from "./checkout/basket-nudges";

/**
 * What the basket drawer renders. Built on the server from the same quote
 * checkout uses (src/server/cart.ts → getBasketSnapshot), so the drawer can
 * never show a price or total that checkout would then change.
 */

export interface BasketLine {
  readonly itemId: string;
  readonly productId: string;
  readonly slug: string;
  readonly name: string;
  readonly brandName: string;
  readonly imageUrl: string | null;
  readonly quantity: number;
  /** Units that can actually ship (may be below quantity). */
  readonly quantityAvailable: number;
  readonly unitPaise: number;
  readonly listUnitPaise: number;
  readonly lineTotalPaise: number;
  readonly status: "OK" | "PARTIAL" | "BLOCKED";
  readonly message: string | null;
  /** Set when the unit price moved since the shopper added the item. */
  readonly priceNote: string | null;
}

export interface BasketOffer {
  readonly bundleId: string;
  readonly name: string;
  readonly missing: number;
  readonly discountLabel: string;
  readonly suggestions: readonly { productId: string; slug: string; name: string; pricePaise: number }[];
}

export interface BasketSnapshot {
  /** Total units, for the menu badge. */
  readonly count: number;
  readonly lines: readonly BasketLine[];
  readonly itemsPaise: number;
  readonly savingsPaise: number;
  readonly shippingPaise: number;
  readonly totalPaise: number;
  readonly freeDelivery: FreeDeliveryProgress;
  readonly appliedOffers: readonly { id: string; name: string; discountPaise: number }[];
  readonly nextOffer: BasketOffer | null;
  readonly canProceed: boolean;
}

export const MAX_LINE_QUANTITY = 20;

export const EMPTY_BASKET: BasketSnapshot = {
  count: 0,
  lines: [],
  itemsPaise: 0,
  savingsPaise: 0,
  shippingPaise: 0,
  totalPaise: 0,
  freeDelivery: { qualified: false, gapPaise: 0, fraction: 0 },
  appliedOffers: [],
  nextOffer: null,
  canProceed: false,
};

export type BasketResult = { ok: true; basket: BasketSnapshot } | { ok: false; message: string; basket?: BasketSnapshot };
