"use server";

import { after } from "next/server";
import { z } from "zod";
import {
  addToCart,
  getBasketSnapshot,
  getOrCreateSessionId,
  readSessionId,
  removeUnavailable,
  updateQuantities,
  updateQuantity,
  writeBasketCount,
} from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { removeCartBox, saveCartBox } from "@/server/boxes";
import { reportError } from "@/lib/observability";
import { EMPTY_BASKET, MAX_LINE_QUANTITY, type BasketResult } from "@/lib/basket-types";
import { db } from "@/lib/db";
import { orderTokenMatches } from "@/lib/order-access";
import { boxFallbackMessage, canReorder, looseLines, orderBoxes, partialNote, reorderLines, reorderMessage } from "@/lib/reorder";
import { samePicks } from "@/lib/saved-boxes";
import { getCustomer } from "@/server/customer-auth";

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

const setManySchema = z.array(setSchema).min(1).max(6);

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

/** Where an add came from, for measuring: the product page (default) or a product card's quick add. */
const viaSchema = z.enum(["card"]).optional();

export async function addToBasket(productId: string, quantity: number, via?: "card"): Promise<BasketResult> {
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
      metadata: { quantity: parsed.data.quantity, ...(viaSchema.safeParse(via).data ? { via } : {}) },
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

const reorderSchema = z.object({ orderNumber: z.string().min(1).max(40), token: z.string().max(200).nullable() });

/**
 * "Order again": a past order's products back in this basket, at today's
 * prices and stock (src/lib/reorder.ts). Only for whoever can open the order:
 * its link token, or the signed-in shopper it belongs to. Anyone else gets the
 * same answer as for an order that doesn't exist.
 */
export async function reorderToBasket(orderNumber: string, token: string | null): Promise<BasketResult> {
  const parsed = reorderSchema.safeParse({ orderNumber, token });
  if (!parsed.success) return { ok: false, message: "That order couldn't be found." };
  let order;
  try {
    order = await db.order.findUnique({
      where: { orderNumber: parsed.data.orderNumber },
      select: { status: true, accessToken: true, customerId: true, boxSnapshot: true, items: { select: { productId: true, productNameSnapshot: true, quantity: true } } },
    });
  } catch (error) {
    reportError("basket/reorder", error);
    return { ok: false, message: TRY_AGAIN };
  }
  const allowed =
    order && (orderTokenMatches(parsed.data.token, order.accessToken) || (order.customerId !== null && (await getCustomer())?.id === order.customerId));
  if (!order || !allowed) return { ok: false, message: "That order couldn't be found." };
  if (!canReorder(order.status)) return { ok: false, message: "This order is still waiting for its payment, and its items are still in your basket." };

  const all = reorderLines(order.items).slice(0, 30);
  const sessionId = await getOrCreateSessionId();
  // Each box goes back as a box, checked against its rules and stock today;
  // one that can't goes back as loose items, with a note saying why.
  const boxes = orderBoxes(order.boxSnapshot);
  const notes: string[] = [];
  let lines = looseLines(all, boxes);
  let boxesAdded = 0;
  // The same box already in the basket (pressed twice, or an unpaid order's
  // basket still full) counts as back in, not added again.
  const inBasket = boxes.length
    ? await db.cartBox.findMany({ where: { cart: { sessionId }, boxId: { in: boxes.map((b) => b.boxId) } }, select: { boxId: true, items: { select: { productId: true, quantity: true } } } })
    : [];
  for (const box of boxes) {
    const twin = inBasket.findIndex((c) => c.boxId === box.boxId && samePicks(c.items, box.picks));
    if (twin >= 0) {
      inBasket.splice(twin, 1);
      boxesAdded += 1;
      continue;
    }
    let reason: string;
    try {
      const saved = await saveCartBox(sessionId, { boxId: box.boxId, picks: box.picks });
      if (saved.ok) {
        boxesAdded += 1;
        continue;
      }
      reason = saved.message;
    } catch (error) {
      reportError("basket/reorder-box", error, { boxId: box.boxId });
      reason = "Something went wrong";
    }
    notes.push(boxFallbackMessage(box.name, reason));
    lines = reorderLines([...lines.map((l) => ({ productId: l.productId, productNameSnapshot: l.name, quantity: l.quantity })), ...box.picks.map((p) => ({ productId: p.productId, productNameSnapshot: all.find((l) => l.productId === p.productId)?.name ?? "An item", quantity: p.quantity }))]);
  }
  const missed: string[] = [];
  for (const line of lines) {
    try {
      await addToCart(sessionId, line.productId, line.quantity, { atLeast: true });
    } catch (error) {
      const known = error instanceof Error && /isn't available|stores only|sold out/.test(error.message);
      if (!known) reportError("basket/reorder-line", error, { productId: line.productId });
      missed.push(line.name);
    }
  }
  const added = lines.length - missed.length;
  if (added + boxesAdded > 0) after(() => recordEvent(sessionId, "ADD_TO_CART", { metadata: { via: "reorder", lines: added, boxes: boxesAdded } }));
  try {
    const basket = await snapshotFor(sessionId);
    // Boxes that went in count as added, so a missed loose item never reads as "nothing was added".
    const missedNote = reorderMessage(missed, lines.length + boxesAdded);
    const shortNote = partialNote(basket.lines, lines.map((l) => l.productId));
    const message = [...notes, ...(missedNote ? [missedNote] : []), ...(shortNote ? [shortNote] : [])].join(" ") || null;
    return message ? { ok: false, message, basket } : { ok: true, basket };
  } catch (error) {
    reportError("basket/reorder-snapshot", error);
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

/** A kit's products together (add or remove a kit), as one change. */
export async function setBasketQuantities(changes: { itemId: string; quantity: number }[]): Promise<BasketResult> {
  const parsed = setManySchema.safeParse(changes);
  if (!parsed.success) return { ok: false, message: "Choose a quantity between 0 and 20." };

  const sessionId = await readSessionId();
  if (!sessionId) return { ok: true, basket: EMPTY_BASKET };
  try {
    await updateQuantities(sessionId, parsed.data);
    return { ok: true, basket: await snapshotFor(sessionId) };
  } catch (error) {
    reportError("basket/set-many", error);
    return { ok: false, message: TRY_AGAIN };
  }
}

const boxSchema = z.object({
  boxId: z.string().min(1).max(40),
  picks: z.array(z.object({ productId: z.string().min(1).max(40), quantity: z.number().int().min(1).max(10) })).min(1).max(12),
  replaceCartBoxId: z.string().min(1).max(40).optional(),
});

/**
 * Put a finished box in the basket (Make Your Own Box), or replace the one
 * being edited. The server checks the box's rules and stock again; nothing
 * the shopper's browser says about prices is used.
 */
export async function saveBox(input: { boxId: string; picks: { productId: string; quantity: number }[]; replaceCartBoxId?: string }): Promise<BasketResult> {
  const parsed = boxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That box couldn't be added. Reload the page and try again." };
  const sessionId = await getOrCreateSessionId();
  try {
    const saved = await saveCartBox(sessionId, parsed.data);
    if (!saved.ok) return { ok: false, message: saved.message, basket: await snapshotFor(sessionId) };
  } catch (error) {
    reportError("basket/save-box", error, { boxId: input.boxId });
    return { ok: false, message: TRY_AGAIN };
  }
  after(() =>
    recordEvent(sessionId, "ADD_TO_CART", { metadata: { via: "box", boxId: parsed.data.boxId, items: parsed.data.picks.length } }),
  );
  try {
    return { ok: true, basket: await snapshotFor(sessionId) };
  } catch (error) {
    reportError("basket/save-box-snapshot", error);
    return { ok: false, message: "Added, but your basket didn't refresh. Open it again to see it." };
  }
}

export async function removeBox(cartBoxId: string): Promise<BasketResult> {
  if (typeof cartBoxId !== "string" || cartBoxId.length === 0 || cartBoxId.length > 40) return { ok: false, message: TRY_AGAIN };
  const sessionId = await readSessionId();
  if (!sessionId) return { ok: true, basket: EMPTY_BASKET };
  try {
    await removeCartBox(sessionId, cartBoxId);
    return { ok: true, basket: await snapshotFor(sessionId) };
  } catch (error) {
    reportError("basket/remove-box", error);
    return { ok: false, message: TRY_AGAIN };
  }
}
