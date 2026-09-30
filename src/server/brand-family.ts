import "server-only";
import { unstable_cache } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { CATALOG_TAG } from "@/lib/cache-tags";
import { reportError } from "@/lib/observability";
import { canonicalUrl, type BrandDomain, type DomainMode } from "@/lib/brand-domains";

/**
 * The brand family: every active brand with its domain setting and social
 * links, in the order the storefront lists them. Read by the family strip,
 * the footer, canonical links and the proxy (src/lib/brand-domains.ts).
 */

export interface FamilyBrand extends BrandDomain {
  name: string;
  tagline: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  xUrl: string | null;
  youtubeUrl: string | null;
}

/** The True Store first (the retail brand), then the gummies brands in their usual order. */
const ORDER = ["the-true-store", "woman-axis", "kids-vault", "man-rituals"];

export const getBrandFamily = unstable_cache(
  async (): Promise<FamilyBrand[]> => {
    try {
      const rows = await db.brand.findMany({
        where: { isActive: true },
        select: { slug: true, name: true, tagline: true, domain: true, domainMode: true, instagramUrl: true, facebookUrl: true, xUrl: true, youtubeUrl: true },
      });
      return rows
        .map((r) => ({ ...r, domainMode: r.domainMode as DomainMode }))
        .sort((a, b) => (ORDER.indexOf(a.slug) + 1 || 99) - (ORDER.indexOf(b.slug) + 1 || 99) || a.name.localeCompare(b.name));
    } catch (error) {
      reportError("brand-family", error);
      return [];
    }
  },
  ["brand-family"],
  { revalidate: 300, tags: [CATALOG_TAG] },
);

/*
 * For the proxy, which runs before every request: brands whose domain is in
 * use, held in memory for a minute. A change on the Brands page takes up to
 * a minute to reach each running instance. If the database can't be read,
 * the last known list is kept (or none), so the main site is never affected.
 */
let proxyCache: { at: number; brands: BrandDomain[] } | null = null;
let inflight: Promise<BrandDomain[]> | null = null;

export async function brandDomainsForProxy(): Promise<BrandDomain[]> {
  if (proxyCache && Date.now() - proxyCache.at < 60_000) return proxyCache.brands;
  inflight ??= db.brand
    .findMany({ where: { isActive: true, domain: { not: null }, domainMode: { not: "OFF" } }, select: { slug: true, domain: true, domainMode: true } })
    .then((rows) => {
      const brands = rows.map((r) => ({ ...r, domainMode: r.domainMode as DomainMode }));
      proxyCache = { at: Date.now(), brands };
      return brands;
    })
    .catch((error) => {
      reportError("brand-domains", error);
      proxyCache = { at: Date.now(), brands: proxyCache?.brands ?? [] };
      return proxyCache.brands;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The brand whose own domain this request came in on (set by the proxy), or null on the main site. */
export async function brandHost(): Promise<string | null> {
  const slug = (await headers()).get("x-brand-host");
  return slug && /^[a-z0-9-]{2,40}$/.test(slug) ? slug : null;
}

/** The one address search engines should index for this page (src/lib/brand-domains.ts). */
export async function canonicalFor(path: string, brandSlug: string | null): Promise<string> {
  return canonicalUrl(path, brandSlug, await getBrandFamily(), siteUrl());
}

export function siteUrl(): string {
  return process.env.SITE_URL ?? "http://localhost:3000";
}
