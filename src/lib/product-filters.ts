/**
 * Parses the /admin/products query string. Same rule as order-filters.ts:
 * every value is checked against a fixed list, a caller-supplied list of
 * real ids, or a range — unknown values fall back to the default.
 */

export const PRODUCT_VIEWS = {
  all: "All",
  live: "Live",
  draft: "Drafts",
  low: "Running low",
  out: "Out of stock",
  review: "Claims review",
} as const;

export type ProductView = keyof typeof PRODUCT_VIEWS;

export type ProductFilters = { view: ProductView; q: string; brand: string | undefined; page: number };

export const PRODUCTS_PAGE_SIZE = 25;

export function parseProductFilters(
  params: { view?: string; q?: string; brand?: string; page?: string },
  brandIds: readonly string[],
): ProductFilters {
  const view = params.view && Object.hasOwn(PRODUCT_VIEWS, params.view) ? (params.view as ProductView) : "all";
  const q = (params.q ?? "").trim().slice(0, 100);
  const brand = params.brand && brandIds.includes(params.brand) ? params.brand : undefined;
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(params.page)) || 1));
  return { view, q, brand, page };
}

export function productFiltersHref(f: Partial<ProductFilters>): string {
  const q = new URLSearchParams();
  if (f.view && f.view !== "all") q.set("view", f.view);
  if (f.q) q.set("q", f.q);
  if (f.brand) q.set("brand", f.brand);
  if (f.page && f.page > 1) q.set("page", String(f.page));
  const s = q.toString();
  return `/admin/products${s ? `?${s}` : ""}`;
}
