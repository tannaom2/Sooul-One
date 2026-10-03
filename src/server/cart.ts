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
import { buildQuote, type Quote, type QuoteBox, type QuoteCredit, type QuoteLineInput } from "@/lib/checkout/quote";
import { boxIssues, boxIssueMessage, boxKindLabel } from "@/lib/checkout/boxes";
import { BOX_RULE_INCLUDE, boxRuleOf } from "@/server/boxes";
import { groupKits } from "@/lib/checkout/kits";
import { freeDeliveryProgress, growKitOptions, rankOfferNudges, settleNudge, type OfferNudge } from "@/lib/checkout/basket-nudges";
import { MAX_LINE_QUANTITY, type BasketBox, type BasketKit, type BasketSnapshot } from "@/lib/basket-types";
import { formatINR, formatPriceTag } from "@/lib/money";
import { IN_STOCK_BATCH_WHERE, SELLABLE_BATCH_WHERE, SELLABLE_PRODUCT_WHERE, isSellable, priceChangeNote, unavailableFixes } from "@/lib/basket-rules";
import { SLOWEST_SERVED_ZONE, estimateDeliveryDate, zoneForPincode } from "@/lib/checkout/delivery";
import { gstTreatmentFor } from "@/lib/checkout/service-area";
import { resolveUnitPrice } from "@/lib/pricing";
import type { BundleRule } from "@/lib/checkout/bundles";
import { getShippingPolicy, getStoreControls } from "@/server/store-settings";
import { extraDeliveryDays } from "@/server/intel";
import { couponValidity, minimumOrderMessage } from "@/lib/checkout/coupons";
import { productAvailability } from "@/lib/checkout/availability";

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

const CART_ITEM_INCLUDE = {
  product: {
    include: {
      brand: true,
      category: { select: { isActive: true } },
      batches: { where: SELLABLE_BATCH_WHERE, orderBy: { expiresOn: "asc" as const } },
      images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
    },
  },
  variant: true,
};

type PricedProduct = {
  basePrice: { toString(): string };
  discountActive: boolean;
  discountPercent: { toString(): string } | null;
};

/**
 * The unit price the shopper pays now: a variant's own price replaces the
 * base, and the product's discount applies on top of whichever it is.
 */
function liveUnitPrice(product: PricedProduct, variant?: { priceOverride: { toString(): string } | null } | null) {
  const listPaise = variant?.priceOverride ? decimalToPaise(variant.priceOverride) : decimalToPaise(product.basePrice);
  return resolveUnitPrice(listPaise, {
    active: Boolean(product.discountActive),
    percent: product.discountPercent == null ? null : Number(product.discountPercent.toString()),
  });
}

/** priceAtAdd is stored in rupees (Decimal 10,2). */
const paiseToDecimal = (paise: number) => (paise / 100).toFixed(2);

/**
 * "Price has gone up/dropped since you added this", or null. priceAtAdd is
 * the price the shopper saw, refreshed whenever they act on the line.
 */
export function priceNoteFor(item: {
  priceAtAdd: { toString(): string };
  product: PricedProduct;
  variant?: { priceOverride: { toString(): string } | null } | null;
}): string | null {
  return priceChangeNote(decimalToPaise(item.priceAtAdd), liveUnitPrice(item.product, item.variant).pricePaise, formatPriceTag);
}

export async function getCart(sessionId: string) {
  return db.cart.findUnique({
    where: { sessionId },
    include: { items: { include: CART_ITEM_INCLUDE } },
  });
}

export async function addToCart(sessionId: string, productId: string, quantity: number) {
  // One statement, so two first adds at once (a double tap) can't both try to
  // create the basket and trip the unique session (audit L5).
  const cart = await db.cart.upsert({ where: { sessionId }, create: { sessionId }, update: {} });

  const product = await db.product.findUnique({
    where: { id: productId },
    include: {
      brand: { select: { isActive: true } },
      category: { select: { isActive: true } },
      batches: { where: IN_STOCK_BATCH_WHERE },
    },
  });
  if (!product || !isSellable(product)) throw new Error("That product isn't available.");
  if (product.retailOnly) throw new Error("That product is sold in our stores only.");
  // The same stock rule the product page and basket use: nothing that can't
  // ship goes in (a stale tab or an offer suggestion could otherwise add it).
  if (productAvailability(product, estimateDeliveryDate(new Date(), SLOWEST_SERVED_ZONE)).state === "out") {
    throw new Error("That's just sold out.");
  }

  // The price the shopper is looking at, snapshotted server-side (never taken
  // from the client). It only drives the "price changed" note: the quote
  // always charges the live price, so a stale basket can't lock in a
  // withdrawn promotion. Adding again means they've seen the current price.
  const priceAtAdd = paiseToDecimal(liveUnitPrice(product).pricePaise);
  const existing = await db.cartItem.findFirst({ where: { cartId: cart.id, productId } });

  if (existing) {
    await db.cartItem.update({
      where: { id: existing.id },
      // Capped per line, matching the quantity control; repeated adds used to grow without limit.
      data: { quantity: Math.min(MAX_LINE_QUANTITY, existing.quantity + quantity), priceAtAdd },
    });
  } else {
    await db.cartItem.create({
      data: { cartId: cart.id, productId, quantity: Math.min(MAX_LINE_QUANTITY, quantity), priceAtAdd },
    });
  }

  return cart.id;
}

/**
 * Several quantities in one go, for a kit: its products move together, so a
 * kit can't end up half added. Each goes through updateQuantity's rules.
 */
export async function updateQuantities(sessionId: string, changes: readonly { itemId: string; quantity: number }[]) {
  for (const c of changes) await updateQuantity(sessionId, c.itemId, c.quantity);
}

/** The quote's combos as basket kits, with each product's basket line attached (no suggestions). */
function basketKits(quote: Quote, cartItems: readonly { id: string; productId: string }[]): BasketKit[] {
  const itemIdByProduct = new Map(cartItems.map((i) => [i.productId, i.id]));
  const quantityByProduct = new Map(quote.lines.map((l) => [l.productId, l.quantityRequested]));
  return groupKits(quote).map((kit) => ({
    ...kit,
    members: kit.members.map((m) => ({
      ...m,
      itemId: itemIdByProduct.get(m.productId) ?? "",
      quantity: quantityByProduct.get(m.productId) ?? 0,
    })),
    growWith: [],
    growLabel: null,
  }));
}

type CartQuote = NonNullable<Awaited<ReturnType<typeof quoteCart>>>;

/** The basket as the bundle engine takes it: list price per unit, units that can ship. */
function engineLinesOf(quote: Quote) {
  return quote.lines.map((l) => ({
    productId: l.productId,
    unitPaise: l.quantityAvailable > 0 ? Math.round(l.listGrossPaise / l.quantityAvailable) : 0,
    // Box items belong to their box; kits and offer prompts leave them alone.
    quantity: l.boxId ? 0 : l.quantityAvailable,
  }));
}

const ORDINAL: Record<number, string> = { 3: "third", 4: "fourth", 5: "fifth", 6: "sixth" };

/**
 * The basket's kits, each with up to three in-stock products that would grow
 * it (checked against the engine, so the saving shown is what the basket
 * gives), for the drawer and the basket page alike. A kit that has already
 * taken an extra product gets no more suggestions.
 */
export async function loadBasketKits(result: CartQuote): Promise<BasketKit[]> {
  const { quote, cartItems, bundles, bundlePrices, bundleListPrices } = result;
  const kits = basketKits(quote, cartItems);
  if (kits.length === 0) return kits;

  const lines = engineLinesOf(quote);
  const options = new Map(
    kits.map((kit) => {
      const rule = bundles.find((b) => b.id === kit.bundleId);
      // One suggestion per kit: once a kit has taken an extra product, stop offering more.
      const units = kit.members.reduce((n, m) => n + m.units, 0);
      if (!rule || units > kit.sets * Math.max(rule.minItems, 1)) return [kit.bundleId, [] as { productId: string; savingPaise: number }[]] as const;
      const candidates = (rule?.eligibleProductIds ?? []).map((id) => ({ productId: id, listPaise: bundleListPrices.get(id) ?? 0 }));
      return [kit.bundleId, growKitOptions(kit.bundleId, lines, bundles, candidates)] as const;
    }),
  );
  const ids = [...new Set([...options.values()].flat().map((o) => o.productId))];
  const products =
    ids.length > 0
      ? await db.product.findMany({
          where: { id: { in: ids }, ...SELLABLE_PRODUCT_WHERE, retailOnly: false },
          include: { batches: { where: IN_STOCK_BATCH_WHERE } },
        })
      : [];
  const arrives = estimateDeliveryDate(new Date(), SLOWEST_SERVED_ZONE);
  const buyable = new Map(products.filter((p) => productAvailability(p, arrives).state !== "out").map((p) => [p.id, p]));

  return kits.map((kit) => {
    const growWith = (options.get(kit.bundleId) ?? [])
      .filter((o) => buyable.has(o.productId))
      .slice(0, 3)
      .map((o) => ({
        productId: o.productId,
        name: buyable.get(o.productId)!.name,
        pricePaise: bundlePrices.get(o.productId) ?? 0,
        savingPaise: o.savingPaise,
      }));
    if (growWith.length === 0) return kit;
    const rule = bundles.find((b) => b.id === kit.bundleId)!;
    const off = (v: number) => (rule.discountType === "PERCENTAGE" ? `${v}% off` : `${formatPriceTag(Math.round(v * 100))} off`);
    const size = Math.max(rule.minItems, 1) + 1;
    const whose = kit.sets > 1 ? "one of your kits becomes" : "your kit becomes";
    const growLabel =
      rule.stepUpValue != null
        ? `Add a ${ORDINAL[size] ?? `${size}th`} product: ${whose} ${off(rule.stepUpValue)}`
        : `Add another product to your kit, also at ${off(rule.discountValue)}`;
    return { ...kit, growWith, growLabel };
  });
}

export async function updateQuantity(sessionId: string, itemId: string, quantity: number) {
  const cart = await db.cart.findUnique({ where: { sessionId } });
  if (!cart) return;

  if (quantity <= 0) {
    await db.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
    return;
  }
  const item = await db.cartItem.findFirst({
    where: { id: itemId, cartId: cart.id },
    include: { product: true, variant: true },
  });
  if (!item) return;
  await db.cartItem.update({
    where: { id: item.id },
    // Changing the quantity with the current price on screen acknowledges it,
    // so the "price changed" note clears.
    data: {
      quantity: Math.min(MAX_LINE_QUANTITY, quantity),
      priceAtAdd: paiseToDecimal(liveUnitPrice(item.product, item.variant).pricePaise),
    },
  });
}

/**
 * "Remove unavailable items": drop lines that can't ship at all and trim the
 * ones that can only partly ship to what's in stock. Uses the same quote
 * checkout does, so what's left can check out.
 */
export async function removeUnavailable(sessionId: string): Promise<void> {
  const result = await quoteCart(sessionId);
  if (!result) return;
  const itemIdByProduct = new Map(result.cartItems.map((i) => [i.productId, i.id]));
  const { remove, trim } = unavailableFixes(
    result.quote.lines.filter((l) => !l.boxId).map((l) => ({
      itemId: itemIdByProduct.get(l.productId) ?? "",
      quantity: l.quantityRequested,
      quantityAvailable: l.quantityAvailable,
    })),
  );
  const cartFilter = { cart: { sessionId } };
  // A box item that can't ship comes out of its box; the box then asks for a swap.
  const blockedBoxItems = result.cartBoxes.flatMap((b) =>
    b.items.filter((i) => result.quote.lines.some((l) => l.boxId === b.cartBoxId && l.productId === i.productId && l.status !== "OK")).map((i) => i.id),
  );
  await db.$transaction([
    db.cartItem.deleteMany({ where: { id: { in: remove.filter(Boolean) }, ...cartFilter } }),
    ...trim.map((t) => db.cartItem.updateMany({ where: { id: t.itemId, ...cartFilter }, data: { quantity: t.quantity } })),
    db.cartBoxItem.deleteMany({ where: { id: { in: blockedBoxItems }, cartBox: { cart: { sessionId } } } }),
  ]);
}

export async function clearCart(sessionId: string) {
  // Filtered through the cart relation, not a lookup then a delete.
  await db.$transaction([
    db.cartItem.deleteMany({ where: { cart: { sessionId } } }),
    db.cartBox.deleteMany({ where: { cart: { sessionId } } }),
  ]);
}

export interface QuoteContext {
  pincode?: string;
  state?: string;
  couponCode?: string;
  /** Referral credit on offer for this shopper (src/server/referrals.ts); checkout only. */
  credit?: QuoteCredit | null;
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
  const [controls, shipping] = await Promise.all([getStoreControls(), getShippingPolicy()]);
  const [items, cartBoxRows, bundleRows, found] = await Promise.all([
    db.cartItem.findMany({ where: { cart: { sessionId } }, include: CART_ITEM_INCLUDE }),
    db.cartBox.findMany({
      where: { cart: { sessionId } },
      include: { box: { include: BOX_RULE_INCLUDE }, items: { include: { product: CART_ITEM_INCLUDE.product } } },
      orderBy: { createdAt: "asc" },
    }),
    controls.bundlesEnabled
      ? db.bundle.findMany({
          where: { isActive: true },
          include: {
            eligibleProducts: {
              include: { product: { select: { id: true, basePrice: true, discountActive: true, discountPercent: true } } },
            },
          },
        })
      : Promise.resolve([]),
    context.couponCode
      ? db.coupon.findUnique({ where: { code: context.couponCode.toUpperCase() } })
      : Promise.resolve(null),
  ]);
  if (items.length === 0 && cartBoxRows.length === 0) return null;
  const cart = { items };

  const zone = context.pincode ? zoneForPincode(context.pincode) : SLOWEST_SERVED_ZONE;
  // Plus any days the owner added for this pincode (a slow lane, a flood): cached, so no extra round trip.
  const extraDays = await extraDeliveryDays(context.pincode);
  const estimatedDeliveryDate = new Date(estimateDeliveryDate(new Date(), zone).getTime() + extraDays * 24 * 60 * 60 * 1000);

  const gstTreatment = gstTreatmentFor(context.state, SELLER_STATE);

  const toLine = (item: { productId: string; quantity: number; variantId?: string | null; variant?: { priceOverride: { toString(): string } | null } | null; product: (typeof items)[number]["product"] }, boxId?: string): QuoteLineInput => {
    const price = liveUnitPrice(item.product, item.variant);

    return {
      boxId,
      productId: item.productId,
      variantId: item.variantId ?? undefined,
      name: item.product.name,
      regulatoryType: item.product.regulatoryType,
      unitPricePaise: price.pricePaise,
      listPricePaise: price.listPaise,
      quantity: item.quantity,
      taxRatePercent: Number(item.product.taxRatePercent?.toString?.() ?? 18),
      shelfLifeDays: item.product.shelfLifeDays ?? undefined,
      batches: item.product.batches.map((b) => ({
        id: b.id,
        batchNumber: b.batchNumber,
        expiresOn: new Date(b.expiresOn),
        quantityRemaining: b.quantityRemaining,
      })),
      stockQuantity: item.product.stockQuantity,
      retailOnly: item.product.retailOnly,
      // A basket can outlive its products: switching off the product, its
      // brand or its category takes it off sale here too.
      active: isSellable(item.product),
    };
  };
  const lines: QuoteLineInput[] = [
    ...cart.items.map((item) => toLine(item)),
    ...cartBoxRows.flatMap((cb) => cb.items.map((i) => toLine(i, cb.id))),
  ];

  // Each box the shopper built, checked against its rules as they stand now.
  const cartBoxes = cartBoxRows.map((cb) => {
    const rule = boxRuleOf(cb.box);
    const issues = cb.box.isActive
      ? boxIssues(rule, cb.items.map((i) => ({ productId: i.productId, quantity: i.quantity })))
      : [{ kind: "NOT_IN_BOX" as const, productId: "" }];
    const nameOf = (id: string) => cb.items.find((i) => i.productId === id)?.product.name ?? "An item";
    return {
      cartBoxId: cb.id,
      box: { id: cb.box.id, slug: cb.box.slug, name: cb.box.name, kind: cb.box.kind, isActive: cb.box.isActive, pricePaise: rule.pricePaise, size: cb.box.size },
      items: cb.items,
      issue: !cb.box.isActive ? "This box isn't available any more. Remove it, or its items stay at their usual price." : issues[0] ? boxIssueMessage(issues[0], nameOf) : null,
    };
  });
  const boxes: QuoteBox[] = cartBoxes.map((b) => ({ id: b.cartBoxId, boxId: b.box.id, name: b.box.name, pricePaise: b.box.pricePaise, complete: b.issue === null }));

  const bundles: BundleRule[] = bundleRows.map((b) => ({
    id: b.id,
    name: b.name,
    minItems: b.minItems,
    maxItems: b.maxItems,
    discountType: b.discountType,
    discountValue: Number(b.discountValue.toString()),
    stepUpValue: b.stepUpValue == null ? null : Number(b.stepUpValue.toString()),
    eligibleProductIds: b.eligibleProducts.map((e) => e.productId),
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

  const built = buildQuote({ lines, estimatedDeliveryDate, gstTreatment, coupon, bundles, boxes, credit: context.credit ?? undefined, shipping });
  // A box that needs attention holds checkout: its items would otherwise be
  // charged at their usual prices without the shopper deciding to.
  const quote: Quote = cartBoxes.some((b) => b.issue) ? { ...built, canProceed: false } : built;
  if (coupon?.minOrderPaise && quote.couponShortfallPaise > 0) {
    couponMessage = minimumOrderMessage(coupon.minOrderPaise, quote.couponShortfallPaise, formatINR);
  }

  // What each bundle product sells for today, so offers can be ranked by rupees saved,
  // and its list price, which the bundle engine prices from.
  const bundlePrices = new Map<string, number>();
  const bundleListPrices = new Map<string, number>();
  for (const b of bundleRows) {
    for (const e of b.eligibleProducts) {
      bundleListPrices.set(e.productId, decimalToPaise(e.product.basePrice));
      bundlePrices.set(
        e.productId,
        resolveUnitPrice(decimalToPaise(e.product.basePrice), {
          active: Boolean(e.product.discountActive),
          percent: e.product.discountPercent == null ? null : Number(e.product.discountPercent.toString()),
        }).pricePaise,
      );
    }
  }
  if (quote.couponBlockedByCombo) couponMessage = "Discount codes don't apply to items already priced as a combo.";

  return {
    quote,
    cartItems: cart.items,
    cartBoxes,
    gstTreatment,
    bundles,
    bundlePrices,
    bundleListPrices,
    estimatedDeliveryDate,
    shipping,
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
  const { quote, cartItems, bundles, bundlePrices, bundleListPrices } = result;
  const itemById = new Map(cartItems.map((i) => [i.productId, i]));
  const kits = await loadBasketKits(result);
  const kitUnits = new Map(kits.flatMap((k) => k.members.map((m) => [m.productId, m.units] as const)));

  const lines = quote.lines.filter((line) => !line.boxId).map((line) => {
    const item = itemById.get(line.productId);
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
      priceNote: item ? priceNoteFor(item) : null,
      kitUnits: kitUnits.get(line.productId) ?? 0,
    };
  });

  // What quote.ts compares against the free-delivery threshold.
  const discounted = quote.subtotalPaise - quote.bundleDiscountPaise - quote.discountPaise;
  const shippable = quote.lines.filter((l) => l.quantityAvailable > 0 && !l.boxId).map((l) => l.productId);
  // Every offer within reach, kept only where the engine would really apply it
  // (a product already in a kit can't make a second offer), best first.
  const engineLines = engineLinesOf(quote);
  const settled = rankOfferNudges(shippable, bundles, quote.appliedBundles.map((b) => b.id), bundlePrices)
    .map((n) => settleNudge(n, engineLines, bundles, bundleListPrices))
    .filter((n): n is OfferNudge => n !== null);

  // Only products that can ship now, checked in one query for all of them and
  // filtered before choosing, so a sold-out product never takes a place a
  // buyable one could have had. The first offer with enough left wins.
  const candidates =
    settled.length > 0
      ? await db.product.findMany({
          where: { id: { in: [...new Set(settled.flatMap((n) => n.suggestProductIds))] }, ...SELLABLE_PRODUCT_WHERE, retailOnly: false },
          include: { batches: { where: IN_STOCK_BATCH_WHERE } },
        })
      : [];
  const arrives = estimateDeliveryDate(new Date(), SLOWEST_SERVED_ZONE);
  const buyable = new Map(candidates.filter((p) => productAvailability(p, arrives).state !== "out").map((p) => [p.id, p]));
  const buyableFor = (n: OfferNudge) => n.suggestProductIds.filter((id) => buyable.has(id));
  const nudge = settled.find((n) => buyableFor(n).length >= n.missing);

  let nextOffer: BasketSnapshot["nextOffer"] = null;
  if (nudge) {
    const suggested = buyableFor(nudge)
      .slice(0, 3)
      .map((id) => buyable.get(id)!);
    nextOffer = {
      bundleId: nudge.bundleId,
      name: nudge.name,
      missing: nudge.missing,
      discountLabel:
        nudge.discountType === "PERCENTAGE" ? `${nudge.discountValue}% off` : `${formatPriceTag(Math.round(nudge.discountValue * 100))} off`,
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

  const boxes = basketBoxes(result);
  return {
    // A kit or a box counts as one item; units outside them count one each.
    count: lines.reduce((n, l) => n + Math.max(0, l.quantity - l.kitUnits), 0) + kits.reduce((n, k) => n + k.sets, 0) + boxes.length,
    lines,
    itemsPaise: quote.listSubtotalPaise,
    savingsPaise: quote.productDiscountPaise + quote.bundleDiscountPaise + quote.discountPaise,
    shippingPaise: quote.shippingPaise,
    totalPaise: quote.totalPaise,
    freeDelivery: freeDeliveryProgress(discounted, result.shipping.freeAbovePaise),
    appliedOffers: [
      ...quote.appliedBundles.map((b) => ({ id: b.id, name: b.name, discountPaise: b.discountPaise })),
      ...quote.appliedBoxes.map((b) => ({ id: b.boxId, name: b.name, discountPaise: b.discountPaise })),
    ],
    kits,
    boxes,
    nextOffer: nextOffer && nextOffer.suggestions.length >= nextOffer.missing ? nextOffer : null,
    canProceed: quote.canProceed,
  };
}

/** The shopper's boxes as the basket shows them: price paid, what the items would cost, what's wrong. */
export function basketBoxes(result: Pick<CartQuote, "quote" | "cartBoxes">): BasketBox[] {
  return result.cartBoxes.map((b) => {
    const boxLines = result.quote.lines.filter((l) => l.boxId === b.cartBoxId);
    const listPaise = boxLines.reduce((n, l) => n + l.listGrossPaise, 0);
    const finalPaise = boxLines.reduce((n, l) => n + l.grossPaise - l.bundleDiscountPaise, 0);
    return {
      cartBoxId: b.cartBoxId,
      boxId: b.box.id,
      slug: b.box.slug,
      name: b.box.name,
      kindLabel: boxKindLabel(b.box.kind),
      available: b.box.isActive,
      size: b.box.size,
      boxPricePaise: b.box.pricePaise,
      listPaise,
      finalPaise,
      savingPaise: Math.max(0, listPaise - finalPaise),
      issue: b.issue,
      items: b.items.map((i) => {
        const line = boxLines.find((l) => l.productId === i.productId);
        return {
          productId: i.productId,
          slug: i.product.slug,
          name: i.product.name,
          brandName: i.product.brand?.name ?? "",
          quantity: i.quantity,
          message: line && line.status !== "OK" ? (line.customerMessage ?? null) : null,
        };
      }),
    };
  });
}

/** Rewrite the menu-badge cookie from the server's basket. Server Actions and route handlers only. */
export async function writeBasketCount(count: number): Promise<void> {
  const store = await cookies();
  store.set(BASKET_COUNT_COOKIE, String(Math.max(0, count)), BASKET_COUNT_COOKIE_OPTIONS);
}
