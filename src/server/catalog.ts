import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { CATALOG_TAG, STORES_TAG } from "@/lib/cache-tags";
import { decimalToPaise } from "@/lib/format";
import { resolveUnitPrice } from "@/lib/pricing";
import { productAvailability, type AvailabilityState } from "@/lib/checkout/availability";
import { SLOWEST_SERVED_ZONE, estimateDeliveryDate } from "@/lib/checkout/delivery";
import { ageLabel, sugarLabel, unitPriceLabel } from "@/lib/label-facts";
import { formatINR } from "@/lib/money";
import { SELLABLE_PRODUCT_WHERE } from "@/lib/basket-rules";

/**
 * Catalog reads.
 *
 * Everything the storefront renders goes through here so that the shape a page
 * receives is decided once. Prisma Decimal values are converted to integer
 * paise at this boundary — no page should ever see a Decimal, because that is
 * how float arithmetic creeps back into pricing.
 */

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  /** What the shopper pays — product discount already applied. */
  pricePaise: number;
  /** Struck-through price: the undiscounted price when a discount is live, else the manual was-price. */
  comparePaise: number | null;
  /** Percentage off when a discount is live. */
  percentOff: number | null;
  regulatoryType: "PACKAGED_FOOD" | "HEALTH_SUPPLEMENT" | "BEVERAGE";
  isVeg: boolean | null;
  allergens: string[];
  brandSlug: string;
  brandName: string;
  categoryName: string;
  /** For the brand-page concern filter. */
  categorySlug: string;
  /** "₹30.00 per 100 g" or "₹16.63 per serving"; null if the size wasn't declared. */
  unitPriceLabel: string | null;
  availableInRetail: boolean;
  retailOnly: boolean;
  imageUrl: string | null;
  /** The basket's own stock rule, so a card never promises what the basket refuses. */
  availability: { state: AvailabilityState; shippableUnits: number };
  /** Approved reviews only; null when there are none yet. */
  rating: RatingSummary | null;
  /** "1.5 g sugar per serving", from the declared label; null if undeclared. */
  sugarLabel: string | null;
  /** "For ages 4–12"; null if no age was declared. */
  ageLabel: string | null;
}

export interface RatingSummary {
  /** Mean of approved ratings, one decimal. */
  avg: number;
  count: number;
}

/** Average and count of approved reviews for each product id. */
async function ratingsFor(productIds: string[]): Promise<Map<string, RatingSummary>> {
  if (productIds.length === 0) return new Map();
  const rows = await db.review.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, isApproved: true },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return new Map(
    rows.map((r) => [r.productId, { avg: Math.round((r._avg.rating ?? 0) * 10) / 10, count: r._count._all }]),
  );
}

/** Summaries with their ratings attached, in one extra grouped query. */
async function withRatings(rows: { id: string }[]): Promise<ProductSummary[]> {
  const ratings = await ratingsFor(rows.map((r) => r.id));
  return rows.map((row) => ({ ...toSummary(row), rating: ratings.get(row.id) ?? null }));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function displayPrice(p: any) {
  const resolved = resolveUnitPrice(decimalToPaise(p.basePrice), {
    active: Boolean(p.discountActive),
    percent: p.discountPercent == null ? null : Number(p.discountPercent.toString()),
  });
  const comparePaise =
    resolved.percentOff !== null
      ? resolved.listPaise
      : p.compareAtPrice
        ? decimalToPaise(p.compareAtPrice)
        : null;
  return { pricePaise: resolved.pricePaise, comparePaise, percentOff: resolved.percentOff };
}

function toSummary(p: any): ProductSummary {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    shortDescription: p.shortDescription,
    ...displayPrice(p),
    regulatoryType: p.regulatoryType,
    isVeg: p.isVeg,
    allergens: p.allergens ?? [],
    brandSlug: p.brand?.slug ?? "",
    brandName: p.brand?.name ?? "",
    categoryName: p.category?.name ?? "",
    categorySlug: p.category?.slug ?? "",
    unitPriceLabel: unitPriceLabel(p, displayPrice(p).pricePaise, formatINR),
    availableInRetail: p.availableInRetail,
    retailOnly: p.retailOnly,
    imageUrl: p.images?.find((i: any) => i.isPrimary)?.url ?? p.images?.[0]?.url ?? null,
    availability: cardAvailability(p),
    rating: null,
    sugarLabel: sugarLabel(p),
    ageLabel: ageLabel(p.suitableFromAge, p.suitableToAge),
  };
}

function cardAvailability(p: any): ProductSummary["availability"] {
  const a = productAvailability(
    {
      regulatoryType: p.regulatoryType,
      shelfLifeDays: p.shelfLifeDays,
      stockQuantity: p.stockQuantity ?? 0,
      lowStockThreshold: p.lowStockThreshold ?? 0,
      retailOnly: Boolean(p.retailOnly),
      batches: (p.batches ?? []).map((b: any) => ({
        id: b.id,
        batchNumber: b.batchNumber,
        expiresOn: new Date(b.expiresOn),
        quantityRemaining: b.quantityRemaining,
      })),
    },
    estimateDeliveryDate(new Date(), SLOWEST_SERVED_ZONE),
  );
  return { state: a.state, shippableUnits: a.shippableUnits };
}

const LIST_INCLUDE = {
  brand: true,
  category: true,
  images: { orderBy: { sortOrder: "asc" as const } },
  batches: {
    where: { quantityRemaining: { gt: 0 } },
    select: { id: true, batchNumber: true, expiresOn: true, quantityRemaining: true },
  },
};

/*
 * Every read below is cached across requests and tagged, so a page view
 * normally costs no database round trip. Writes that change what shoppers see
 * expire the tag (src/lib/cache-tags.ts); the 5-minute revalidate is only a
 * safety net, e.g. for shelf-life eligibility, which moves with the date.
 *
 * unstable_cache, not React's cache(): a thrown error is never stored, so one
 * database blip can't wedge a route (see the note on getProductBySlug). Results
 * pass through JSON, so Dates arrive as ISO strings and Decimals as strings;
 * every caller already goes through new Date() / decimalToPaise().
 */
const CATALOG = { revalidate: 300, tags: [CATALOG_TAG] };

export const getBrands = unstable_cache(
  async () =>
    db.brand.findMany({
      where: { isActive: true },
      include: { categories: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
    }),
  ["brands"],
  CATALOG,
);

export const getBrandBySlug = unstable_cache(
  async (slug: string) =>
    db.brand.findUnique({
      where: { slug },
      include: { categories: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
    }),
  ["brand-by-slug"],
  CATALOG,
);

export const getProductsByBrand = unstable_cache(
  async (brandSlug: string): Promise<ProductSummary[]> => {
    const rows = await db.product.findMany({
      where: { ...SELLABLE_PRODUCT_WHERE, brand: { slug: brandSlug, isActive: true } },
      include: LIST_INCLUDE,
      orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
    });
    return withRatings(rows);
  },
  ["products-by-brand"],
  CATALOG,
);

export const getGummiesProducts = unstable_cache(
  async (): Promise<ProductSummary[]> => {
    const rows = await db.product.findMany({
      where: { ...SELLABLE_PRODUCT_WHERE, regulatoryType: "HEALTH_SUPPLEMENT" },
      include: LIST_INCLUDE,
      orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
    });
    return withRatings(rows);
  },
  ["gummies-products"],
  CATALOG,
);

export const getFeatured = unstable_cache(
  async (limit = 6): Promise<ProductSummary[]> => {
    const rows = await db.product.findMany({
      where: { ...SELLABLE_PRODUCT_WHERE, isFeatured: true },
      include: LIST_INCLUDE,
      take: limit,
    });
    return withRatings(rows);
  },
  ["featured"],
  CATALOG,
);

/**
 * generateMetadata() and the page component both call this; the cross-request
 * cache now serves both. Deliberately not React's cache(): that memoizes the
 * promise itself, including a rejected one, and verified live it broke the
 * page permanently (500 on every request) after a single database hiccup.
 */
export const getProductBySlug = unstable_cache(
  async (slug: string) => {
    const product = await db.product.findUnique({
      where: { slug },
      include: {
        brand: true,
        category: true,
        images: { orderBy: { sortOrder: "asc" } },
        variants: true,
        batches: { orderBy: { expiresOn: "asc" } },
        reviews: { where: { isApproved: true }, orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    if (!product) return null;
    // The page lists the latest 10; the average covers every approved review.
    const rating = (await ratingsFor([product.id])).get(product.id) ?? null;
    return { ...product, rating };
  },
  ["product-by-slug"],
  CATALOG,
);

export const getStores = unstable_cache(
  async () => db.storeLocation.findMany({ where: { isActive: true }, orderBy: { city: "asc" } }),
  ["stores"],
  { revalidate: 300, tags: [STORES_TAG] },
);
