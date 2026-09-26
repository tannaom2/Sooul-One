"use server";

import { after } from "next/server";
import { z } from "zod";
import {
  addToCart,
  getBasketSnapshot,
  getOrCreateSessionId,
  readSessionId,
  removeUnavailable,
  updateQuantity,
  writeBasketCount,
} from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { reportError } from "@/lib/observability";
import { EMPTY_BASKET, MAX_LINE_QUANTITY, type BasketResult } from "@/lib/basket-types";

/**
 * Basket Server Actions for the drawer (src/components/basket). Each returns
 * the whole fresh basket, so the browser never has to work out a price.
 * Guest shoppers are allowed by design: these act only on the caller's own
 * session cookie, never on an id passed in from the browser.
 */

const addSchema = z.object({
  productId: z.string().min(1).max(40),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});
const setSchema = z.object({
  itemId: z.string().min(1).max(40),
  quantity: z.number().int().min(0).max(MAX_LINE_QUANTITY),
});

const TRY_AGAIN = "That didn't save. Check your connection and try again.";

async function snapshotFor(sessionId: string) {
  const basket = (await getBasketSnapshot(sessionId)) ?? EMPTY_BASKET;
  await writeBasketCount(basket.count);
  return basket;
}

export async function loadBasket(): Promise<BasketResult> {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      await writeBasketCount(0);
      return { ok: true, basket: EMPTY_BASKET };
    }
    return { ok: true, basket: await snapshotFor(sessionId) };
  } catch (error) {
    reportError("basket/load", error);
    return { ok: false, message: "Your basket didn't load. Try again in a moment." };
  }
}

export async function addToBasket(productId: string, quantity: number): Promise<BasketResult> {
  const parsed = addSchema.safeParse({ productId, quantity });
  if (!parsed.success) return { ok: false, message: "Choose a quantity between 1 and 20." };

  const sessionId = await getOrCreateSessionId();
  try {
    await addToCart(sessionId, parsed.data.productId, parsed.data.quantity);
  } catch (error) {
    // addToCart throws shopper-safe messages for unavailable products.
    const known = error instanceof Error && /isn't available|stores only|sold out/.test(error.message);
    if (!known) reportError("basket/add", error, { productId });
    return { ok: false, message: known ? (error as Error).message : TRY_AGAIN };
  }

  after(() =>
    recordEvent(sessionId, "ADD_TO_CART", {
      productId: parsed.data.productId,
      metadata: { quantity: parsed.data.quantity },
    }),
  );

  try {
    return { ok: true, basket: await snapshotFor(sessionId) };
  } catch (error) {
    reportError("basket/add-snapshot", error);
    return { ok: false, message: "Added, but your basket didn't refresh. Open it again to see it." };
  }
}

const manySchema = z.array(z.string().min(1).max(40)).min(1).max(6);

/**
 * "Add all to basket" for a combo: one of each product. Each is checked like a
 * single add; if one has just sold out, the rest still go in and the shopper
 * is told which didn't.
 */
export async function addManyToBasket(productIds: string[]): Promise<BasketResult> {
  const parsed = manySchema.safeParse(productIds);
  if (!parsed.success) return { ok: false, message: "That combo couldn't be added. Reload the page and try again." };

  const sessionId = await getOrCreateSessionId();
  const missed: string[] = [];
  for (const productId of new Set(parsed.data)) {
    try {
      await addToCart(sessionId, productId, 1);
      after(() => recordEvent(sessionId, "ADD_TO_CART", { productId, metadata: { quantity: 1, via: "combo" } }));
    } catch (error) {
      const known = error instanceof Error && /isn't available|stores only|sold out/.test(error.message);
      if (!known) reportError("basket/add-many", error, { productId });
      missed.push(productId);
    }
  }
  try {
    const basket = await snapshotFor(sessionId);
    if (missed.length === 0) return { ok: true, basket };
    const names = missed.length === parsed.data.length ? "none of them" : `${missed.length} of them`;
    return { ok: false, message: `Added what was available: ${names} could be added just now.`, basket };
  } catch (error) {
    reportError("basket/add-many-snapshot", error);
    return { ok: false, message: "Added, but your basket didn't refresh. Open it again to see it." };
  }
}

/** Drop what can't ship and trim what partly can, so the basket can check out. */
export async function removeUnavailableItems(): Promise<BasketResult> {
  const sessionId = await readSessionId();
  if (!sessionId) return { ok: true, basket: EMPTY_BASKET };
  try {
    await removeUnavailable(sessionId);
    return { ok: true, basket: await snapshotFor(sessionId) };
  } catch (error) {
    reportError("basket/remove-unavailable", error);
    return { ok: false, message: TRY_AGAIN };
  }
}

export async function setBasketQuantity(itemId: string, quantity: number): Promise<BasketResult> {
  const parsed = setSchema.safeParse({ itemId, quantity });
  if (!parsed.success) return { ok: false, message: "Choose a quantity between 0 and 20." };

  const sessionId = await readSessionId();
  if (!sessionId) return { ok: true, basket: EMPTY_BASKET };
  try {
    await updateQuantity(sessionId, parsed.data.itemId, parsed.data.quantity);
    return { ok: true, basket: await snapshotFor(sessionId) };
  } catch (error) {
    reportError("basket/set", error);
    return { ok: false, message: TRY_AGAIN };
  }
}
