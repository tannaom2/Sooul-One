import "server-only";
import { db } from "@/lib/db";
import { decimalToPaise } from "@/lib/format";

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
  pricePaise: number;
  comparePaise: number | null;
  regulatoryType: "PACKAGED_FOOD" | "HEALTH_SUPPLEMENT" | "BEVERAGE";
  isVeg: boolean | null;
  allergens: string[];
  brandSlug: string;
  brandName: string;
  categoryName: string;
  availableInRetail: boolean;
  retailOnly: boolean;
  imageUrl: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSummary(p: any): ProductSummary {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    shortDescription: p.shortDescription,
    pricePaise: decimalToPaise(p.basePrice),
    comparePaise: p.compareAtPrice ? decimalToPaise(p.compareAtPrice) : null,
    regulatoryType: p.regulatoryType,
    isVeg: p.isVeg,
    allergens: p.allergens ?? [],
    brandSlug: p.brand?.slug ?? "",
    brandName: p.brand?.name ?? "",
    categoryName: p.category?.name ?? "",
    availableInRetail: p.availableInRetail,
    retailOnly: p.retailOnly,
    imageUrl: p.images?.find((i: any) => i.isPrimary)?.url ?? p.images?.[0]?.url ?? null,
  };
}

const LIST_INCLUDE = {
  brand: true,
  category: true,
  images: { orderBy: { sortOrder: "asc" as const } },
};

export async function getBrands() {
  return db.brand.findMany({
    where: { isActive: true },
    include: { categories: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });
}

export async function getBrandBySlug(slug: string) {
  return db.brand.findUnique({
    where: { slug },
    include: { categories: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
  });
}

export async function getProductsByBrand(brandSlug: string): Promise<ProductSummary[]> {
  const rows = await db.product.findMany({
    where: { isActive: true, brand: { slug: brandSlug } },
    include: LIST_INCLUDE,
    orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
  });
  return rows.map(toSummary);
}

export async function getGummiesProducts(): Promise<ProductSummary[]> {
  const rows = await db.product.findMany({
    where: { isActive: true, regulatoryType: "HEALTH_SUPPLEMENT" },
    include: LIST_INCLUDE,
    orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
  });
  return rows.map(toSummary);
}

export async function getFeatured(limit = 6): Promise<ProductSummary[]> {
  const rows = await db.product.findMany({
    where: { isActive: true, isFeatured: true },
    include: LIST_INCLUDE,
    take: limit,
  });
  return rows.map(toSummary);
}

export async function getProductBySlug(slug: string) {
  return db.product.findUnique({
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
}

export async function getStores() {
  return db.storeLocation.findMany({ where: { isActive: true }, orderBy: { city: "asc" } });
}
