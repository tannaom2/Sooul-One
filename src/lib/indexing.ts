import { normalizeHost } from "@/lib/brand-domains";

/**
 * Whether search engines may index a page. Off until the owner opens the shop
 * (SEARCH_INDEXING=on): the site answers on its domain, and on the hosting
 * company's own address, long before launch, and the launch gate only closes
 * checkout. Even when on, only the main domain and a brand's own standalone
 * domain are indexed; any other address the site answers on (the
 * *.onrender.com one) never is, so search engines don't list the shop twice.
 * Pure, tested (tests/indexing.test.ts); applied in src/proxy.ts (a header on
 * every page), src/app/robots.ts and src/app/sitemap.ts.
 */

/** Sent as X-Robots-Tag on every page search engines should leave out. */
export const NOINDEX = "noindex, nofollow";

export function searchIndexingOn(setting: string | undefined): boolean {
  return setting?.trim().toLowerCase() === "on";
}

export function mayIndex(o: { on: boolean; host: string | null; mainHost: string; standaloneBrand: boolean }): boolean {
  if (!o.on) return false;
  return o.standaloneBrand || (o.host !== null && normalizeHost(o.host) === normalizeHost(o.mainHost));
}
