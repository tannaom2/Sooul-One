import type { FreeDeliveryProgress } from "./checkout/basket-nudges";
import type { Kit } from "./checkout/kits";

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
  /** Units shown inside a kit instead of on this line; the line shows the rest. */
  readonly kitUnits: number;
}

/** A combo in the basket, with what the controls need to change it as one unit. */
export interface BasketKit extends Omit<Kit, "members"> {
  readonly members: readonly (Kit["members"][number] & { itemId: string; quantity: number; imageUrl: string | null })[];
  /** In-stock products that would grow this kit (a step-up tier, or one more at its rate), with what each adds. */
  readonly growWith: readonly { productId: string; name: string; pricePaise: number; savingPaise: number }[];
  /** The line above those suggestions, e.g. "Add a third product: your kit becomes 15% off". */
  readonly growLabel: string | null;
}

/** A box the shopper built (Make Your Own Box), shown as one block. */
export interface BasketBox {
  readonly cartBoxId: string;
  readonly boxId: string;
  readonly slug: string;
  readonly name: string;
  /** "Box of Gummies" or "The True Store". */
  readonly kindLabel: string;
  /** False once the owner switches the box off: it can only be removed. */
  readonly available: boolean;
  readonly size: number;
  readonly boxPricePaise: number;
  /** What the items cost at list price. */
  readonly listPaise: number;
  /** What the shopper pays for them. */
  readonly finalPaise: number;
  readonly savingPaise: number;
  /** Why the box isn't complete (and its price doesn't apply), or null. */
  readonly issue: string | null;
  readonly items: readonly { productId: string; slug: string; name: string; brandName: string; imageUrl: string | null; quantity: number; message: string | null }[];
}

export interface BasketOffer {
  readonly bundleId: string;
  readonly name: string;
  readonly missing: number;
  readonly discountLabel: string;
  readonly suggestions: readonly { productId: string; slug: string; name: string; imageUrl: string | null; pricePaise: number }[];
}

export interface BasketSnapshot {
  /** Items for the menu badge: each kit counts once, other units one each. */
  readonly count: number;
  readonly lines: readonly BasketLine[];
  readonly itemsPaise: number;
  readonly savingsPaise: number;
  readonly shippingPaise: number;
  readonly totalPaise: number;
  readonly freeDelivery: FreeDeliveryProgress;
  readonly appliedOffers: readonly { id: string; name: string; discountPaise: number }[];
  readonly kits: readonly BasketKit[];
  readonly boxes: readonly BasketBox[];
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
  kits: [],
  boxes: [],
  nextOffer: null,
  canProceed: false,
};

export type BasketResult = { ok: true; basket: BasketSnapshot } | { ok: false; message: string; basket?: BasketSnapshot };
