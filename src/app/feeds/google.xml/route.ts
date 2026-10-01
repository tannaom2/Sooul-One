import { getSearchCatalog } from "@/server/catalog";
import { getBrandFamily, siteUrl } from "@/server/brand-family";
import { getBusinessProfile } from "@/server/business";
import { canonicalUrl } from "@/lib/brand-domains";
import { absoluteUrl, googleProductFeed } from "@/lib/structured-data";

export const dynamic = "force-dynamic";

/**
 * The Google Merchant Center product feed (F5): every sellable product with
 * its price, stock, photos and canonical link. Add this URL in Merchant
 * Center as a scheduled fetch. Served outside the bot guard (the matcher
 * skips paths with a dot), like the sitemap, so Google's fetcher gets it.
 */
export async function GET() {
  const [catalog, family, business] = await Promise.all([getSearchCatalog(), getBrandFamily(), getBusinessProfile()]);
  const site = siteUrl();
  const body = googleProductFeed(
    catalog.map(({ product, sku, images }) => ({
      name: product.name,
      sku,
      description: product.shortDescription,
      brand: product.brandName || "SooulOne",
      category: product.categoryName || null,
      url: canonicalUrl(`/product/${product.slug}`, product.brandSlug, family, site),
      images: images.map((src) => absoluteUrl(src, site)),
      pricePaise: product.pricePaise,
      inStock: product.availability.state === "in" || product.availability.state === "low",
      rating: product.rating,
    })),
    { title: business.tradeName ?? "SooulOne", siteUrl: site },
  );
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
