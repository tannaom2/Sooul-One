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

/**
 * Expire a tag immediately, from a Server Action or a route handler, so the
 * next shopper sees the change, not the one after.
 */
export function expireTag(tag: typeof CATALOG_TAG | typeof STORES_TAG | typeof BUSINESS_TAG | typeof SETTINGS_TAG): void {
  revalidateTag(tag, { expire: 0 });
}
