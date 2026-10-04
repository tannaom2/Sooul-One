import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { normalizeHost } from "@/lib/brand-domains";
import { getBrandFamily } from "@/server/brand-family";
import { mayIndex, searchIndexingOn } from "@/lib/indexing";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // A standalone brand domain points to its own sitemap (src/app/sitemap.ts).
  const host = normalizeHost((await headers()).get("host"));
  const standalone = (await getBrandFamily()).some((b) => b.domain && b.domainMode === "STANDALONE" && normalizeHost(b.domain) === host);
  const base = standalone ? `https://${host}` : SITE_URL;
  // Before launch, and on any address that isn't the shop's own, pages say
  // noindex (src/proxy.ts). Crawling stays allowed so search engines can read
  // that; there's just no sitemap to send them looking.
  const indexable = mayIndex({ on: searchIndexingOn(process.env.SEARCH_INDEXING), host, mainHost: new URL(SITE_URL).host, standaloneBrand: standalone });
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Per-session (cart/checkout), post-purchase (order), and the owner
      // console, shopper accounts and referral links — none of these are content a search result should ever land
      // a stranger on. Search results pages are thin and endless.
      disallow: ["/admin", "/api", "/cart", "/checkout", "/order", "/account", "/r/", "/search"],
    },
    ...(indexable ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
