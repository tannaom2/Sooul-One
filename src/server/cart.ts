import "server-only";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import {
  BASKET_COUNT_COOKIE,
  BASKET_COUNT_COOKIE_OPTIONS,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/session-cookie";
import { db } from "@/lib/db";
import { decimalToPaise } from "@/lib/format";
import { DEFAULT_SHIPPING_POLICY, buildQuote, type QuoteLineInput } from "@/lib/checkout/quote";
import { freeDeliveryProgress, nextOfferNudge } from "@/lib/checkout/basket-nudges";
import { MAX_LINE_QUANTITY, type BasketSnapshot } from "@/lib/basket-types";
import { formatINR } from "@/lib/money";
import { SLOWEST_SERVED_ZONE, estimateDeliveryDate, zoneForPincode } from "@/lib/checkout/delivery";
import { gstTreatmentFor } from "@/lib/checkout/service-area";
import { resolveUnitPrice } from "@/lib/pricing";
import type { BundleRule } from "@/lib/checkout/bundles";
import { getStoreControls } from "@/server/store-settings";
import { couponValidity, minimumOrderMessage } from "@/lib/checkout/coupons";

/**
 * Cart persistence and quoting.
 *
 * The cart lives in Postgres rather than a cookie, keyed by a guest session id.
 * That survives a device switch, makes abandoned-cart recovery possible later,
 * and keeps prices under server control — a cookie-held cart is a cart the
 * customer can edit.
 */

export { SESSION_COOKIE };

/**
 * The state SooulOne is registered in. Decides CGST+SGST versus IGST.
 * Belongs in configuration, not a literal, because it changes if the company
 * registers in a second state.
 */
const SELLER_STATE = process.env.SELLER_STATE ?? "Gujarat";

export async function getOrCreateSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  if (existing) return existing;

  const id = randomUUID();
  store.set(SESSION_COOKIE, id, SESSION_COOKIE_OPTIONS);
  return id;
}

export async function readSessionId(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const CART_ITEM_INCLUDE = {
  product: {
    include: {
      brand: true,
      batches: { orderBy: { expiresOn: "asc" as const } },
      images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
    },
  },
  variant: true,
};

export async function getCart(sessionId: string) {
  return db.cart.findUnique({
    where: { sessionId },
    include: { items: { include: CART_ITEM_INCLUDE } },
  });
}

export async function addToCart(sessionId: string, productId: string, quantity: number) {
  const cart =
    (await db.cart.findUnique({ where: { sessionId } })) ??
    (await db.cart.create({ data: { sessionId } }));

  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product || !product.isActive) throw new Error("That product isn't available.");
  if (product.retailOnly) throw new Error("That product is sold in our stores only.");

  const existing = await db.cartItem.findFirst({ where: { cartId: cart.id, productId } });

  if (existing) {
    await db.cartItem.update({
      where: { id: existing.id },
      // Capped per line, matching the quantity control; repeated adds used to grow without limit.
      data: { quantity: Math.min(MAX_LINE_QUANTITY, existing.quantity + quantity) },
    });
  } else {
    await db.cartItem.create({
      data: {
        cartId: cart.id,
        productId,
        quantity: Math.min(MAX_LINE_QUANTITY, quantity),
        // Price is snapshotted server-side at add time, never taken from the
        // client. The quote re-reads the live price at checkout so a stale
        // basket cannot lock in a withdrawn promotion.
        priceAtAdd: product.basePrice,
      },
    });
  }

  return cart.id;
}

export async function updateQuantity(sessionId: string, itemId: string, quantity: number) {
  const cart = await db.cart.findUnique({ where: { sessionId } });
  if (!cart) return;

  if (quantity <= 0) {
    await db.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
    return;
  }
  await db.cartItem.updateMany({
    where: { id: itemId, cartId: cart.id },
    data: { quantity: Math.min(MAX_LINE_QUANTITY, quantity) },
  });
}

export async function clearCart(sessionId: string) {
  // One statement (filtered through the cart relation), not a lookup then a delete.
  await db.cartItem.deleteMany({ where: { cart: { sessionId } } });
}

export interface QuoteContext {
  pincode?: string;
  state?: string;
  couponCode?: string;
}

/**
 * Turn a persisted cart into a priced, compliance-checked quote.
 *
 * Live product data is re-read here rather than trusting the cart snapshot,
 * because between adding an item and paying for it the price may have changed
 * and — more importantly — the stock that would fulfil it may have dropped
 * below the shelf-life threshold.
 */
export async function quoteCart(sessionId: string, context: QuoteContext = {}) {
  // Independent reads, so they run in parallel on separate pooled connections:
  // every sequential round trip costs a full trip to the database. The items
  // query starts at CartItem (filtered by the cart's session) to save a level
  // of relation loading compared with going through Cart.
  // The owner can switch bundle offers off (Store controls); cached, so no extra round trip.
  const controls = await getStoreControls();
  const [items, bundleRows, found] = await Promise.all([
    db.cartItem.findMany({ where: { cart: { sessionId } }, include: CART_ITEM_INCLUDE }),
    controls.bundlesEnabled
      ? db.bundle.findMany({ where: { isActive: true }, include: { eligibleProducts: true } })
      : Promise.resolve([]),
    context.couponCode
      ? db.coupon.findUnique({ where: { code: context.couponCode.toUpperCase() } })
      : Promise.resolve(null),
  ]);
  if (items.length === 0) return null;
  const cart = { items };

  const zone = context.pincode ? zoneForPincode(context.pincode) : SLOWEST_SERVED_ZONE;
  const estimatedDeliveryDate = estimateDeliveryDate(new Date(), zone);

  const gstTreatment = gstTreatmentFor(context.state, SELLER_STATE);

  const lines: QuoteLineInput[] = cart.items.map((item: any) => {
    // A variant's own price replaces the base; the product's discount then
    // applies on top of whichever it is.
    const listPaise = item.variant?.priceOverride
      ? decimalToPaise(item.variant.priceOverride)
      : decimalToPaise(item.product.basePrice);
    const price = resolveUnitPrice(listPaise, {
      active: Boolean(item.product.discountActive),
      percent: item.product.discountPercent == null ? null : Number(item.product.discountPercent.toString()),
    });

    return {
      productId: item.productId,
      variantId: item.variantId ?? undefined,
      name: item.product.name,
      regulatoryType: item.product.regulatoryType,
      unitPricePaise: price.pricePaise,
      listPricePaise: price.listPaise,
      quantity: item.quantity,
      taxRatePercent: Number(item.product.taxRatePercent?.toString?.() ?? 18),
      shelfLifeDays: item.product.shelfLifeDays ?? undefined,
      batches: (item.product.batches ?? []).map((b: any) => ({
        id: b.id,
        batchNumber: b.batchNumber,
        expiresOn: new Date(b.expiresOn),
        quantityRemaining: b.quantityRemaining,
      })),
      stockQuantity: item.product.stockQuantity,
      retailOnly: item.product.retailOnly,
      active: item.product.isActive,
    };
  });

  const bundles: BundleRule[] = bundleRows.map((b: any) => ({
    id: b.id,
    name: b.name,
    minItems: b.minItems,
    maxItems: b.maxItems,
    discountType: b.discountType,
    discountValue: Number(b.discountValue.toString()),
    eligibleProductIds: b.eligibleProducts.map((e: any) => e.productId),
  }));

  let coupon;
  let couponMessage: string | null = null;
  if (context.couponCode) {
    const validity = couponValidity(found, new Date());
    if (validity.ok && found) {
      coupon = {
        code: found.code,
        type: found.discountType as "PERCENTAGE" | "FLAT",
        value: Number(found.discountValue.toString()),
        minOrderPaise: found.minOrderValue == null ? null : decimalToPaise(found.minOrderValue),
      };
    } else if (!validity.ok) {
      couponMessage = validity.message;
    }
  }

  const quote = buildQuote({ lines, estimatedDeliveryDate, gstTreatment, coupon, bundles });
  if (coupon?.minOrderPaise && quote.couponShortfallPaise > 0) {
    couponMessage = minimumOrderMessage(coupon.minOrderPaise, quote.couponShortfallPaise, formatINR);
  }

  return {
    quote,
    cartItems: cart.items,
    gstTreatment,
    bundles,
    estimatedDeliveryDate,
    couponRejected: Boolean(context.couponCode) && !quote.appliedCouponCode,
    /** Why the code didn't apply, in words for the shopper. */
    couponMessage: context.couponCode && !quote.appliedCouponCode ? (couponMessage ?? "That code isn't valid for this order.") : null,
  };
}

/**
 * The basket drawer's view of the cart, built from the same quote checkout
 * uses, plus the two prompts (free delivery, next offer). Null for no basket.
 */
export async function getBasketSnapshot(sessionId: string): Promise<BasketSnapshot | null> {
  const result = await quoteCart(sessionId);
  if (!result) return null;
  const { quote, cartItems, bundles } = result;
  const itemById = new Map(cartItems.map((i: any) => [i.productId, i]));

  const lines = quote.lines.map((line) => {
    const item: any = itemById.get(line.productId);
    return {
      itemId: item?.id ?? "",
      productId: line.productId,
      slug: item?.product?.slug ?? "",
      name: line.name,
      brandName: item?.product?.brand?.name ?? "",
      imageUrl: item?.product?.images?.[0]?.url ?? null,
      quantity: line.quantityRequested,
      quantityAvailable: line.quantityAvailable,
      unitPaise: line.quantityAvailable > 0 ? Math.round(line.grossPaise / line.quantityAvailable) : 0,
      listUnitPaise: line.quantityAvailable > 0 ? Math.round(line.listGrossPaise / line.quantityAvailable) : 0,
      lineTotalPaise: line.grossPaise,
      status: line.status,
      message: line.customerMessage ?? null,
    };
  });

  // What quote.ts compares against the free-delivery threshold.
  const discounted = quote.subtotalPaise - quote.bundleDiscountPaise - quote.discountPaise;
  const shippable = quote.lines.filter((l) => l.quantityAvailable > 0).map((l) => l.productId);
  const nudge = nextOfferNudge(shippable, bundles, quote.appliedBundles.map((b) => b.id));

  let nextOffer: BasketSnapshot["nextOffer"] = null;
  if (nudge) {
    const suggested = await db.product.findMany({
      where: { id: { in: [...nudge.suggestProductIds] }, isActive: true, retailOnly: false },
      select: { id: true, slug: true, name: true, basePrice: true, discountActive: true, discountPercent: true },
      take: 3,
    });
    nextOffer = {
      bundleId: nudge.bundleId,
      name: nudge.name,
      missing: nudge.missing,
      discountLabel:
        nudge.discountType === "PERCENTAGE" ? `${nudge.discountValue}% off` : `${formatINR(Math.round(nudge.discountValue * 100))} off`,
      suggestions: suggested.map((p) => ({
        productId: p.id,
        slug: p.slug,
        name: p.name,
        pricePaise: resolveUnitPrice(decimalToPaise(p.basePrice), {
          active: Boolean(p.discountActive),
          percent: p.discountPercent == null ? null : Number(p.discountPercent.toString()),
        }).pricePaise,
      })),
    };
  }

  return {
    count: lines.reduce((n, l) => n + l.quantity, 0),
    lines,
    itemsPaise: quote.listSubtotalPaise,
    savingsPaise: quote.productDiscountPaise + quote.bundleDiscountPaise + quote.discountPaise,
    shippingPaise: quote.shippingPaise,
    totalPaise: quote.totalPaise,
    freeDelivery: freeDeliveryProgress(discounted, DEFAULT_SHIPPING_POLICY.freeAbovePaise),
    appliedOffers: quote.appliedBundles.map((b) => ({ id: b.id, name: b.name, discountPaise: b.discountPaise })),
    nextOffer: nextOffer && nextOffer.suggestions.length >= nextOffer.missing ? nextOffer : null,
    canProceed: quote.canProceed,
  };
}

/** Rewrite the menu-badge cookie from the server's basket. Server Actions and route handlers only. */
export async function writeBasketCount(count: number): Promise<void> {
  const store = await cookies();
  store.set(BASKET_COUNT_COOKIE, String(Math.max(0, count)), BASKET_COUNT_COOKIE_OPTIONS);
}
