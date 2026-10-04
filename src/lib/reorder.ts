import { MAX_LINE_QUANTITY } from "@/lib/basket-types";
import type { BoxPick } from "@/lib/checkout/boxes";
import { parsePicks } from "@/lib/saved-boxes";

/**
 * "Order again" on a past order (benchmark gap R4): its products go back in
 * the basket at today's prices and stock, and each Make Your Own Box in it
 * goes back as a box, at the box price. Pure, so the rules are tested
 * (tests/reorder.test.ts); the action is reorderToBasket in
 * src/app/basket-actions.ts.
 */

export interface ReorderLine {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
}

/**
 * One line per product. An order line split across stock batches is several
 * rows with the same product; they add back up here, capped like any basket line.
 */
export function reorderLines(items: readonly { productId: string; productNameSnapshot: string; quantity: number }[]): ReorderLine[] {
  const lines = new Map<string, ReorderLine>();
  for (const i of items) {
    const cur = lines.get(i.productId);
    lines.set(i.productId, { productId: i.productId, name: cur?.name ?? i.productNameSnapshot, quantity: Math.min(MAX_LINE_QUANTITY, (cur?.quantity ?? 0) + i.quantity) });
  }
  return [...lines.values()];
}

/** A box as the order recorded it (Order.boxSnapshot). */
export interface OrderBox {
  readonly boxId: string;
  readonly name: string;
  readonly picks: readonly BoxPick[];
}

/** The boxes an order recorded, keeping only well-formed ones. Never throws. */
export function orderBoxes(json: unknown): OrderBox[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((b) => {
    if (!b || typeof b !== "object") return [];
    const { boxId, name, picks } = b as Record<string, unknown>;
    const clean = parsePicks(picks);
    return typeof boxId === "string" && boxId && clean.length ? [{ boxId, name: typeof name === "string" && name ? name : "Your box", picks: clean }] : [];
  });
}

/**
 * The order's lines less what its boxes account for: these go back loose,
 * the rest go back inside their boxes. A product both in a box and bought on
 * its own keeps the loose share.
 */
export function looseLines(lines: readonly ReorderLine[], boxes: readonly OrderBox[]): ReorderLine[] {
  const inBoxes = new Map<string, number>();
  for (const p of boxes.flatMap((b) => b.picks)) inBoxes.set(p.productId, (inBoxes.get(p.productId) ?? 0) + p.quantity);
  return lines.map((l) => ({ ...l, quantity: Math.max(0, l.quantity - (inBoxes.get(l.productId) ?? 0)) })).filter((l) => l.quantity > 0);
}

/** A box that couldn't go back as a box, so its items went in loose. */
export function boxFallbackMessage(boxName: string, reason: string): string {
  // Only the first sentence of the reason ("Omega Focus has just sold out."), not its advice.
  const why = reason.split(/\.(?:\s|$)/)[0].trim();
  return `${boxName} couldn't go back in as a box (${why}), so its items were added at their own prices. Rebuild it on the box page for the box price.`;
}

/**
 * Lines the basket can only partly fill today (fewer in stock than the order
 * had), as a note: "Only 1 of Biotin Glow Gummies can be sent right now."
 */
export function partialNote(lines: readonly { productId: string; name: string; status: string; quantityAvailable: number }[], reordered: Iterable<string>): string | null {
  const wanted = new Set(reordered);
  const short = lines.filter((l) => wanted.has(l.productId) && l.status === "PARTIAL");
  if (short.length === 0) return null;
  return short.map((l) => `Only ${l.quantityAvailable} of ${l.name} can be sent right now.`).join(" ");
}

/**
 * Orders still waiting on a payment keep their basket (it empties when the
 * payment clears), so ordering them again would double it.
 */
export function canReorder(status: string): boolean {
  return status !== "PENDING_PAYMENT" && status !== "FAILED";
}

/**
 * Where "Order again" is offered: once an order is on its way or done with.
 * While it's being packed, "again" is noise. The action itself still accepts
 * any order canReorder allows.
 */
export function offerReorder(status: string): boolean {
  return canReorder(status) && status !== "PAID" && status !== "PROCESSING";
}

/** What to tell the shopper about the items that couldn't go back in, or null when all did. */
export function reorderMessage(missed: readonly string[], total: number): string | null {
  if (missed.length === 0) return null;
  if (missed.length === total) return "None of these are available just now, so nothing was added.";
  const names = missed.length <= 2 ? missed.join(" and ") : `${missed.slice(0, 2).join(", ")} and ${missed.length - 2} more`;
  return `Added the rest. ${names} ${missed.length === 1 ? "isn't" : "aren't"} available just now.`;
}
