/**
 * "Shop by concern" (gummies) and "Shop by category" (The True Store). A
 * brand's categories already name concerns (Hair Fall, Sleep Support) or
 * occasions (Namkeen, Gifting), so filtering is by category. The URL value is
 * accepted only if it's one of the brand's own category slugs. Pure, tested.
 */

export interface FilterOption {
  readonly slug: string;
  readonly name: string;
  readonly count: number;
}

/** Categories that have products, in the brand's own order, with counts. */
export function filterOptions(
  categories: readonly { slug: string; name: string }[],
  products: readonly { categorySlug: string }[],
): FilterOption[] {
  return categories
    .map((c) => ({ slug: c.slug, name: c.name, count: products.filter((p) => p.categorySlug === c.slug).length }))
    .filter((o) => o.count > 0);
}

/** The requested category if it's one of the offered options, else none (show all). */
export function activeFilter(requested: string | undefined, options: readonly FilterOption[]): string | null {
  return requested && options.some((o) => o.slug === requested) ? requested : null;
}

export function applyFilter<T extends { categorySlug: string }>(products: readonly T[], active: string | null): T[] {
  return active ? products.filter((p) => p.categorySlug === active) : [...products];
}
