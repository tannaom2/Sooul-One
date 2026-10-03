import "server-only";
import { revalidateTag } from "next/cache";

/**
 * Cache tags for storefront reads (src/server/catalog.ts).
 *
 * The catalogue changes a few times a week but was read from the database on
 * every page view, over a link that can take seconds to connect. Reads are now
 * cached and every write that changes what a shopper sees expires the tag.
 *
 * One tag for the whole catalogue is deliberate at this size: invalidation is
 * rare (admin edits, orders) and a missed narrow tag would show a stale price.
 */
export const CATALOG_TAG = "catalog";
export const STORES_TAG = "stores";
/** The seller's business details: footer, product pages, invoices. */
export const BUSINESS_TAG = "business";
/** The owner's store controls: orders paused, cash on delivery, bundles. */
export const SETTINGS_TAG = "settings";
/** The owner's pincode rules (cash on delivery, extra days) and pincode records. */
export const PINCODE_TAG = "pincodes";
/** Owner-written storefront content: top bar, site text, FAQs, articles, careers. */
export const CONTENT_TAG = "content";

/**
 * Mark a tag stale when only stock moved (an order placed, cancelled or
 * paid late). The next visitor still gets the cached page at once while it
 * refreshes in the background; the one after sees the new stock. Clearing
 * the whole catalog on every order made the next view of every product page
 * wait seconds on a cold cache (benchmark gap F4). Safe because the basket
 * and checkout re-check stock live: a page one order behind can't oversell.
 */
export function refreshTag(tag: typeof CATALOG_TAG): void {
  revalidateTag(tag, "max");
}

/**
 * Expire a tag immediately, from a Server Action or a route handler, so the
 * next shopper sees the change, not the one after. For what a shopper must
 * see at once: a price, a product taken down, a recall.
 */
export function expireTag(
  tag: typeof CATALOG_TAG | typeof STORES_TAG | typeof BUSINESS_TAG | typeof SETTINGS_TAG | typeof PINCODE_TAG | typeof CONTENT_TAG,
): void {
  revalidateTag(tag, { expire: 0 });
}
