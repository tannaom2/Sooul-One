/**
 * Rules a long-lived basket needs (the basket cookie lasts a year, renewed on
 * every visit): what may still be sold, and telling the shopper when a price
 * moved since they added the item. Pure, so the storefront, the basket and the
 * tests share one definition.
 */

/**
 * On sale only when the product, its brand and its category are all switched
 * on. Prisma `where` fragment for catalogue queries.
 */
export const SELLABLE_PRODUCT_WHERE = {
  isActive: true,
  brand: { isActive: true },
  category: { isActive: true },
} as const;

/**
 * Batches that may be sold: not recalled (Stock batches → Recall). Every read
 * that feeds availability, the basket, the checkout quote or a box pool uses
 * this, the database's stock total leaves recalled batches out, and the
 * order's stock take refuses them (src/server/order-stock.ts), so a recall
 * stops sales everywhere at once.
 */
export const SELLABLE_BATCH_WHERE = { recalledAt: null } as const;

/** In stock and sellable: what availability and allocation draw from. */
export const IN_STOCK_BATCH_WHERE = { quantityRemaining: { gt: 0 }, recalledAt: null } as const;

/** The same rule for a product already loaded with its brand and category. */
export function isSellable(product: {
  isActive: boolean;
  brand?: { isActive: boolean } | null;
  category?: { isActive: boolean } | null;
}): boolean {
  return product.isActive && product.brand?.isActive !== false && product.category?.isActive !== false;
}

/**
 * A note for a basket line whose unit price differs from the one the shopper
 * saw when adding it, or null when it hasn't moved. Both in paise.
 */
export function priceChangeNote(
  addedAtPaise: number | null,
  nowPaise: number,
  format: (paise: number) => string,
): string | null {
  if (addedAtPaise == null || addedAtPaise === nowPaise) return null;
  return nowPaise > addedAtPaise
    ? `Price has gone up since you added this: was ${format(addedAtPaise)}, now ${format(nowPaise)}.`
    : `Price has dropped since you added this: was ${format(addedAtPaise)}, now ${format(nowPaise)}.`;
}

/**
 * What "Remove unavailable items" does to each line: drop the ones that can't
 * ship at all, trim the ones that can only partly ship to what's available.
 */
export function unavailableFixes(
  lines: readonly { itemId: string; quantity: number; quantityAvailable: number }[],
): { remove: string[]; trim: { itemId: string; quantity: number }[] } {
  const remove: string[] = [];
  const trim: { itemId: string; quantity: number }[] = [];
  for (const line of lines) {
    if (line.quantityAvailable <= 0) remove.push(line.itemId);
    else if (line.quantityAvailable < line.quantity) trim.push({ itemId: line.itemId, quantity: line.quantityAvailable });
  }
  return { remove, trim };
}
