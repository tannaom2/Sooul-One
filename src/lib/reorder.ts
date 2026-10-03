import { MAX_LINE_QUANTITY } from "@/lib/basket-types";

/**
 * "Order again" on a past order (benchmark gap R4): its products go back in
 * the basket at today's prices and stock. Pure, so the rules are tested
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

/**
 * Orders still waiting on a payment keep their basket (it empties when the
 * payment clears), so ordering them again would double it.
 */
export function canReorder(status: string): boolean {
  return status !== "PENDING_PAYMENT" && status !== "FAILED";
}

/** What to tell the shopper about the items that couldn't go back in, or null when all did. */
export function reorderMessage(missed: readonly string[], total: number): string | null {
  if (missed.length === 0) return null;
  if (missed.length === total) return "None of these are available just now, so nothing was added.";
  const names = missed.length <= 2 ? missed.join(" and ") : `${missed.slice(0, 2).join(", ")} and ${missed.length - 2} more`;
  return `Added the rest. ${names} ${missed.length === 1 ? "isn't" : "aren't"} available just now.`;
}
