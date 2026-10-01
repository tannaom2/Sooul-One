/**
 * The brand family's web addresses. SooulOne is the parent store; each brand
 * lives at sooulone.in/<brand>, and may also have its own domain
 * (womanaxis.in) doing one of three things, chosen per brand on the
 * console's Brands page:
 *
 * - OFF: the domain isn't used.
 * - REDIRECT: every visit is sent on (301) to the brand's page on the main
 *   site, keeping the path, so old links and printed URLs keep working.
 * - STANDALONE: the domain is the brand's own site. Its home page is the
 *   brand page; everything else (products, basket, checkout, help) is the
 *   same store, served on that domain. The owner console stays on the main
 *   site only.
 *
 * Standalone means the same page exists at two addresses, which search
 * engines treat as duplicates. So each brand page and product page names ONE
 * canonical address: the brand domain while it's standalone, the main site
 * otherwise (canonicalUrl below). Pure, so it's tested (tests/brand-domains.test.ts);
 * the proxy applies it (src/proxy.ts).
 *
 * A basket and a sign-in are per domain (browsers keep cookies per site), so
 * a shopper who moves between standalone domains starts a fresh basket.
 * docs/BRANDS.md has the DNS, Razorpay and Turnstile steps for a new domain.
 */

export type DomainMode = "OFF" | "REDIRECT" | "STANDALONE";

export interface BrandDomain {
  readonly slug: string;
  readonly domain: string | null;
  readonly domainMode: DomainMode;
}

/** Where a brand's page is on the main site. */
export function brandPath(slug: string): string {
  return slug === "the-true-store" ? "/true-store" : `/gummies/${slug}`;
}

/** The brand whose own page this path is, if any. */
export function brandForPath(path: string, slugs: readonly string[]): string | null {
  return slugs.find((s) => brandPath(s) === path) ?? null;
}

/** "WWW.WomanAxis.in:443" → "womanaxis.in". */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
}

/**
 * The domain the owner typed, cleaned up ("https://www.WomanAxis.in/" →
 * "womanaxis.in"), or null when it isn't a plain domain name.
 */
export function parseDomain(input: string): string | null {
  const cleaned = normalizeHost(input.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, ""));
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(cleaned) ? cleaned : null;
}

export type HostDecision =
  | { readonly kind: "main" }
  /** 301 for a domain set to REDIRECT (search engines move its ranking over); 302 for the others, which depend on a mode that can change. */
  | { readonly kind: "redirect"; readonly location: string; readonly status: 301 | 302 }
  | { readonly kind: "standalone"; readonly brand: string; readonly rewrite: string | null };

/**
 * What to do with a request, from its host and path. `siteUrl` is the main
 * site ("https://sooulone.in"). Hosts that aren't a brand's domain (the main
 * site, localhost, the onrender.com address) are served as they are.
 */
export function decideHost(host: string, path: string, search: string, brands: readonly BrandDomain[], siteUrl: string): HostDecision {
  const h = normalizeHost(host);
  const main = normalizeHost(safeHost(siteUrl));
  if (!h || h === main) return { kind: "main" };
  const brand = brands.find((b) => b.domain && b.domainMode !== "OFF" && normalizeHost(b.domain) === h);
  if (!brand) return { kind: "main" };

  const base = siteUrl.replace(/\/$/, "");
  if (brand.domainMode === "REDIRECT") {
    return { kind: "redirect", status: 301, location: `${base}${path === "/" ? brandPath(brand.slug) : path}${search}` };
  }
  // Standalone. The owner console lives on the main site only.
  if (path === "/admin" || path.startsWith("/admin/")) return { kind: "redirect", status: 302, location: `${base}${path}${search}` };
  // The brand's page on the main-site path is the home page here: one address for it.
  if (path === brandPath(brand.slug)) return { kind: "redirect", status: 302, location: `https://${h}/${search}` };
  return { kind: "standalone", brand: brand.slug, rewrite: path === "/" ? brandPath(brand.slug) : null };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * The one address search engines should index for a page. `pageBrand` is the
 * brand the page belongs to (a brand page, or a product's brand); pages that
 * belong to no brand (help, learn, the basket) are canonical on the main site.
 */
export function canonicalUrl(path: string, pageBrand: string | null, brands: readonly BrandDomain[], siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, "");
  const brand = pageBrand ? brands.find((b) => b.slug === pageBrand) : undefined;
  if (brand?.domain && brand.domainMode === "STANDALONE") {
    return `https://${normalizeHost(brand.domain)}${path === brandPath(brand.slug) ? "/" : path}`;
  }
  return `${base}${path === "/" ? "" : path}`;
}

/**
 * Where a link to a sister brand should go. A standalone brand's link goes
 * to its own domain; others go to their page on the main site, as a plain
 * path when we're already on the main site, or in full from a brand domain
 * (so a footer link on womanaxis.in sends Kids Vault to sooulone.in).
 */
export function brandHref(slug: string, brands: readonly BrandDomain[], currentBrandHost: string | null, siteUrl: string): string {
  const brand = brands.find((b) => b.slug === slug);
  if (brand?.domain && brand.domainMode === "STANDALONE") {
    return currentBrandHost === slug ? "/" : `https://${normalizeHost(brand.domain)}/`;
  }
  return currentBrandHost ? `${siteUrl.replace(/\/$/, "")}${brandPath(slug)}` : brandPath(slug);
}
