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
import { comboPrice, type BundleRule } from "@/lib/checkout/bundles";
import { getStoreControls } from "@/server/store-settings";

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
  /** Part of a live combo offer (and bundles are switched on in Store controls). */
  inCombo: boolean;
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
  const [ratings, controls] = await Promise.all([ratingsFor(rows.map((r) => r.id)), getStoreControls()]);
  return rows.map((row) => {
    const summary = toSummary(row);
    return { ...summary, inCombo: summary.inCombo && controls.bundlesEnabled, rating: ratings.get(row.id) ?? null };
  });
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
    inCombo: (p.bundleEligibility?.length ?? 0) > 0,
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
  bundleEligibility: { where: { bundle: { isActive: true } }, select: { bundleId: true }, take: 1 },
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

export interface ComboOfferItem {
  productId: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  pricePaise: number;
  listPaise: number;
}

export interface ComboOffer {
  bundleId: string;
  name: string;
  description: string | null;
  /** "fixed": every product in the set is required. "mix": any minItems of them. */
  kind: "fixed" | "mix";
  minItems: number;
  /** Most products one kit takes; null for no limit ("any 2 or more"). */
  maxItems: number | null;
  /** "15% off" or "₹50 off", as the owner set it. */
  discountLabel: string;
  /** The set shown with its combo price: this product plus the others needed. */
  items: ComboOfferItem[];
  listPaise: number;
  salePaise: number;
  comboPaise: number;
  savingPaise: number;
  /** For "mix": other products that can stand in for the ones shown. */
  alternatives: ComboOfferItem[];
}

/**
 * Live combo offers that include this product, each with an example set and
 * its combo price worked out by the basket's own engine (comboPrice), so the
 * product page can't promise a price the basket won't honour. Only products
 * that can ship today are offered, and nothing shows while bundles are
 * switched off in Store controls.
 */
export const getOffersForProduct = unstable_cache(
  async (productId: string): Promise<ComboOffer[]> => {
    const controls = await getStoreControls();
    if (!controls.bundlesEnabled) return [];
    const bundles = await db.bundle.findMany({
      where: { isActive: true, eligibleProducts: { some: { productId } } },
      include: { eligibleProducts: { include: { product: { include: LIST_INCLUDE } } } },
      orderBy: { createdAt: "asc" },
    });

    const offers: ComboOffer[] = [];
    for (const b of bundles) {
      const rule: BundleRule = {
        id: b.id, name: b.name, minItems: b.minItems, maxItems: b.maxItems,
        discountType: b.discountType, discountValue: Number(b.discountValue.toString()),
        eligibleProductIds: b.eligibleProducts.map((e) => e.productId),
      };
      const fixed = b.minItems >= b.eligibleProducts.length;
      const buyable = b.eligibleProducts
        .map((e) => e.product)
        .filter((p) => p.isActive && !p.retailOnly && ["in", "low"].includes(cardAvailability(p).state));
      const toItem = (p: (typeof buyable)[number]): ComboOfferItem => {
        const price = displayPrice(p);
        return {
          productId: p.id, slug: p.slug, name: p.name,
          imageUrl: p.images?.find((i) => i.isPrimary)?.url ?? p.images?.[0]?.url ?? null,
          pricePaise: price.pricePaise, listPaise: decimalToPaise(p.basePrice),
        };
      };
      const self = buyable.find((p) => p.id === productId);
      if (!self) continue;
      if (fixed && buyable.length < b.eligibleProducts.length) continue; // a required product can't ship
      const others = buyable.filter((p) => p.id !== productId).sort((x, y) => Number(y.isFeatured) - Number(x.isFeatured) || x.name.localeCompare(y.name));
      const needed = fixed ? others.length : Math.max(b.minItems, 1) - 1;
      if (others.length < needed) continue;
      const items = [self, ...others.slice(0, needed)].map(toItem);
      const price = comboPrice(rule, items.map((i) => ({ productId: i.productId, unitListPaise: i.listPaise, unitSalePaise: i.pricePaise })));
      if (!price || price.savingPaise <= 0) continue;
      offers.push({
        bundleId: b.id, name: b.name, description: b.description, kind: fixed ? "fixed" : "mix", minItems: b.minItems, maxItems: b.maxItems ?? null,
        discountLabel: b.discountType === "PERCENTAGE" ? `${Number(b.discountValue.toString())}% off` : `₹${Number(b.discountValue.toString())} off`,
        items, ...price, alternatives: fixed ? [] : others.slice(needed, needed + 6).map(toItem),
      });
    }
    return offers;
  },
  ["offers-for-product"],
  CATALOG,
);

export const getStores = unstable_cache(
  async () => db.storeLocation.findMany({ where: { isActive: true }, orderBy: { city: "asc" } }),
  ["stores"],
  { revalidate: 300, tags: [STORES_TAG] },
);
