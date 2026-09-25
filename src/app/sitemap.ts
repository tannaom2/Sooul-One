import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { SELLABLE_PRODUCT_WHERE } from "@/lib/basket-rules";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

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
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
  }));

  const products = await db.product.findMany({
    where: SELLABLE_PRODUCT_WHERE,
    select: { slug: true, updatedAt: true },
  });

  const productEntries: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${SITE_URL}/product/${p.slug}`,
    lastModified: p.updatedAt,
  }));

  return [...staticEntries, ...productEntries];
}
