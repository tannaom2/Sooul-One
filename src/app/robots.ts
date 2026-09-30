import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { normalizeHost } from "@/lib/brand-domains";
import { getBrandFamily } from "@/server/brand-family";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // A standalone brand domain points to its own sitemap (src/app/sitemap.ts).
  const host = normalizeHost((await headers()).get("host"));
  const standalone = (await getBrandFamily()).some((b) => b.domain && b.domainMode === "STANDALONE" && normalizeHost(b.domain) === host);
  const base = standalone ? `https://${host}` : SITE_URL;
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Per-session (cart/checkout), post-purchase (order), and the owner
      // console, shopper accounts and referral links — none of these are content a search result should ever land
      // a stranger on. Search results pages are thin and endless.
      disallow: ["/admin", "/api", "/cart", "/checkout", "/order", "/account", "/r/", "/search"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
