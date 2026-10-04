/**
 * What search engines and shopping surfaces read about a product (F5):
 * schema.org Product JSON-LD on each product page, for rich results (price,
 * stock, rating), and a Google Merchant Center feed of every sellable product.
 * The same data lets AI shopping agents read the catalogue. Pure, so it's
 * tested (tests/structured-data.test.ts).
 *
 * Only what the page itself shows: the short description (already through
 * the claims check for supplements), the price the shopper pays, real stock,
 * and ratings only when approved reviews exist.
 */

export interface StructuredProduct {
  readonly name: string;
  readonly sku: string;
  readonly description: string;
  readonly brand: string;
  readonly category: string | null;
  /** Absolute canonical URL of the product page. */
  readonly url: string;
  /** Absolute image URLs. */
  readonly images: readonly string[];
  readonly pricePaise: number;
  readonly inStock: boolean;
  readonly rating: { readonly avg: number; readonly count: number } | null;
}

const rupees = (paise: number) => (paise / 100).toFixed(2);

/** An absolute URL for a path or a full URL, against the site's address. */
export function absoluteUrl(pathOrUrl: string, siteUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${siteUrl.replace(/\/$/, "")}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

export function productJsonLd(p: StructuredProduct, seller: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    sku: p.sku,
    description: p.description,
    ...(p.images.length ? { image: [...p.images] } : {}),
    brand: { "@type": "Brand", name: p.brand },
    ...(p.category ? { category: p.category } : {}),
    offers: {
      "@type": "Offer",
      url: p.url,
      priceCurrency: "INR",
      price: rupees(p.pricePaise),
      availability: p.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: seller },
    },
    ...(p.rating && p.rating.count > 0
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: p.rating.avg.toFixed(1), reviewCount: p.rating.count, bestRating: "5", worstRating: "1" } }
      : {}),
  };
}

/**
 * JSON for a <script type="application/ld+json">: "<" is escaped, so text a
 * product name contains can never close the script element.
 */
/**
 * Who sells: on the home page, so search results can show the business's own
 * name, logo and customer-care contact (Settings → Business details).
 */
export function organizationJsonLd(o: { name: string; url: string; logo: string; phone: string | null; email: string | null }): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: o.name,
    url: o.url,
    logo: o.logo,
    ...(o.phone || o.email
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer service",
            areaServed: "IN",
            ...(o.phone ? { telephone: o.phone } : {}),
            ...(o.email ? { email: o.email } : {}),
          },
        }
      : {}),
  };
}

/** The site's own name for search results ("SooulOne", not the domain). */
export function websiteJsonLd(o: { name: string; url: string }): Record<string, unknown> {
  return { "@context": "https://schema.org", "@type": "WebSite", name: o.name, url: o.url };
}

/** Where a page sits: Home › Gummies › Woman Axis › a product. Shown by search results in place of the raw URL. */
export function breadcrumbJsonLd(trail: readonly { name: string; url: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({ "@type": "ListItem", position: i + 1, name: step.name, item: step.url })),
  };
}

/**
 * The trail to a brand's page, as the shop's own menu has it: The True Store
 * is a shop of its own; the gummy brands sit under Gummies. `brandUrl` is the
 * brand page's canonical address (its own domain, when it has one).
 */
export function brandTrail(brand: { name: string; slug: string }, brandUrl: string, siteUrl: string): { name: string; url: string }[] {
  const home = { name: "Home", url: absoluteUrl("/", siteUrl) };
  if (brand.slug === "the-true-store") return [home, { name: brand.name, url: brandUrl }];
  return [home, { name: "Gummies", url: absoluteUrl("/gummies", siteUrl) }, { name: brand.name, url: brandUrl }];
}

export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/**
 * A Google Merchant Center product feed (RSS 2.0 with the g: namespace).
 * Products without a photo are left out: Merchant Center rejects them.
 * No GTINs exist yet, so identifier_exists is "no" with the brand and SKU.
 */
export function googleProductFeed(items: readonly StructuredProduct[], store: { title: string; siteUrl: string }): string {
  const entries = items
    .filter((p) => p.images.length > 0)
    .map(
      (p) => `    <item>
      <g:id>${xml(p.sku)}</g:id>
      <g:title>${xml(p.name.slice(0, 150))}</g:title>
      <g:description>${xml(p.description.slice(0, 5000))}</g:description>
      <g:link>${xml(p.url)}</g:link>
      <g:image_link>${xml(p.images[0])}</g:image_link>
${p.images
  .slice(1, 11)
  .map((img) => `      <g:additional_image_link>${xml(img)}</g:additional_image_link>`)
  .join("\n")}${p.images.length > 1 ? "\n" : ""}      <g:availability>${p.inStock ? "in_stock" : "out_of_stock"}</g:availability>
      <g:price>${rupees(p.pricePaise)} INR</g:price>
      <g:brand>${xml(p.brand)}</g:brand>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>
      <g:mpn>${xml(p.sku)}</g:mpn>${p.category ? `\n      <g:product_type>${xml(p.category)}</g:product_type>` : ""}
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${xml(store.title)}</title>
    <link>${xml(store.siteUrl)}</link>
    <description>${xml(store.title)} products</description>
${entries}
  </channel>
</rss>
`;
}
