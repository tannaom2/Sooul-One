import "server-only";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/session-cookie";
import { db } from "@/lib/db";
import { decimalToPaise } from "@/lib/format";
import { buildQuote, type QuoteLineInput } from "@/lib/checkout/quote";
import { estimateDeliveryDate, zoneForPincode } from "@/lib/checkout/delivery";
import type { GstTreatment } from "@/lib/money";
import { resolveUnitPrice } from "@/lib/pricing";
import type { BundleRule } from "@/lib/checkout/bundles";

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
const SELLER_STATE = (process.env.SELLER_STATE ?? "Maharashtra").toLowerCase();

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

export async function getCart(sessionId: string) {
  return db.cart.findUnique({
    where: { sessionId },
    include: {
      items: {
        include: {
          product: {
            include: { brand: true, batches: { orderBy: { expiresOn: "asc" } } },
          },
          variant: true,
        },
      },
    },
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
      data: { quantity: existing.quantity + quantity },
    });
  } else {
    await db.cartItem.create({
      data: {
        cartId: cart.id,
        productId,
        quantity,
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
  await db.cartItem.updateMany({ where: { id: itemId, cartId: cart.id }, data: { quantity } });
}

export async function clearCart(sessionId: string) {
  const cart = await db.cart.findUnique({ where: { sessionId } });
  if (cart) await db.cartItem.deleteMany({ where: { cartId: cart.id } });
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
  const cart = await getCart(sessionId);
  if (!cart || cart.items.length === 0) return null;

  const zone = context.pincode ? zoneForPincode(context.pincode) : "REST_OF_INDIA";
  const estimatedDeliveryDate = estimateDeliveryDate(new Date(), zone);

  const gstTreatment: GstTreatment =
    context.state && context.state.toLowerCase() === SELLER_STATE ? "INTRA_STATE" : "INTER_STATE";

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
    };
  });

  const bundleRows = await db.bundle.findMany({
    where: { isActive: true },
    include: { eligibleProducts: true },
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
  if (context.couponCode) {
    const found = await db.coupon.findUnique({ where: { code: context.couponCode.toUpperCase() } });
    const now = new Date();
    if (
      found &&
      found.isActive &&
      new Date(found.validFrom) <= now &&
      new Date(found.validUntil) >= now &&
      (found.maxUses === null || found.usedCount < found.maxUses)
    ) {
      coupon = {
        code: found.code,
        type: found.discountType as "PERCENTAGE" | "FLAT",
        value: Number(found.discountValue.toString()),
      };
    }
  }

  const quote = buildQuote({ lines, estimatedDeliveryDate, gstTreatment, coupon, bundles });

  return {
    quote,
    cartItems: cart.items,
    estimatedDeliveryDate,
    couponRejected: Boolean(context.couponCode) && !quote.appliedCouponCode,
  };
}
