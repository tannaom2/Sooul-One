import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { SELLABLE_PRODUCT_WHERE } from "@/lib/basket-rules";
import { brandPath, canonicalUrl, normalizeHost } from "@/lib/brand-domains";
import { getBrandFamily, siteUrl } from "@/server/brand-family";

// Generated per-request, not baked into the build — the product list
// changes far more often than the app gets redeployed.
export const dynamic = "force-dynamic";

const STATIC_PATHS = [
  "",
  "/true-store",
  "/gummies",
  "/gummies/woman-axis",
  "/gummies/kids-vault",
  "/gummies/man-rituals",
  "/stores",
  "/help",
  "/contact",
  "/verify",
  "/learn",
  "/policies/privacy",
  "/policies/terms",
  "/policies/refunds",
  "/policies/shipping",
];

/**
 * Generated at request time from live data, not a static file to hand-edit —
 * DEPLOYING.md used to say to edit a checked-in sitemap.xml, which never
 * actually existed in this repo. Cart, checkout and admin are deliberately
 * excluded: they're per-session or gated, not content Google should index.
 *
 * Each domain lists only the pages it's the canonical home of
 * (src/lib/brand-domains.ts): a standalone brand domain lists its home page
 * and its products; the main site lists everything else.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const family = await getBrandFamily();
  const base = siteUrl();
  const host = normalizeHost((await headers()).get("host"));
  const hostBrand = family.find((b) => b.domain && b.domainMode === "STANDALONE" && normalizeHost(b.domain) === host)?.slug ?? null;

  const products = await db.product.findMany({
    where: SELLABLE_PRODUCT_WHERE,
    select: { slug: true, updatedAt: true, brand: { select: { slug: true } } },
  });
  const articles = hostBrand ? [] : await db.article.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }).catch(() => []);

  const entries: MetadataRoute.Sitemap = [];
  const add = (path: string, brand: string | null, lastModified: Date) => {
    const url = canonicalUrl(path, brand, family, base);
    // Only this domain's own pages.
    if (normalizeHost(new URL(url).host) === (hostBrand ? host : normalizeHost(new URL(base).host))) entries.push({ url, lastModified });
  };

  const now = new Date();
  for (const path of STATIC_PATHS) add(path, family.find((b) => brandPath(b.slug) === path)?.slug ?? null, now);
  for (const p of products) add(`/product/${p.slug}`, p.brand.slug, p.updatedAt);
  for (const a of articles) add(`/learn/${a.slug}`, null, a.updatedAt);
  return entries;
}
