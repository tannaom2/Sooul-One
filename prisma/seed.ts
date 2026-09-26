/**
 * Seed — build prompt Section 9, Phase 1.
 *
 * Two rules govern this file, and they pull in opposite directions:
 *
 *   1. Where the brief was explicit, it is copied verbatim. The Kids Vault,
 *      Man Rituals and Woman Axis category lists are reproduced exactly as
 *      given, in the order given (Decision #7).
 *
 *   2. Where the brief was not explicit, nothing is invented. The True Store's
 *      taxonomy is the proposed set from Section 6, marked below for
 *      confirmation. The two beverage lines get reserved, inactive brand rows
 *      and nothing else — no categories, no products, no names. Section 14 is
 *      unambiguous that the caffeinated-beverage line's name and the Healthy
 *      Beverages line's definition are the business's to decide, and a seeded
 *      placeholder has a way of becoming a shipped product.
 *
 * No products are seeded at all. Every real SKU carries nutrition facts,
 * allergens and supplement dosing that have direct legal weight under FSSAI
 * labelling law, and those come from formulation records, not from here.
 *
 * Run with: npm run db:seed
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires an explicit driver adapter — see src/lib/db.ts for the
// full reasoning. This script is a one-off CLI run rather than a long-lived
// server, so it builds its own client instead of importing the app's shared
// singleton (which also assumes Next.js's module-reload lifecycle).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Neutral placeholder. Real accents land when the brand kit exists. */
const PLACEHOLDER_COLOR = "#6B7280";

interface BrandSeed {
  slug: string;
  name: string;
  tagline?: string;
  isRetailBrand?: boolean;
  isActive?: boolean;
  categories: string[];
  note?: string;
}

const toSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const BRANDS: BrandSeed[] = [
  {
    slug: "the-true-store",
    name: "The True Store",
    isRetailBrand: true,
    note: "Categories PROPOSED (Section 6) — confirm or replace before launch. Nothing downstream depends on these exact names.",
    categories: ["Healthy Namkeen", "Healthy Sweets", "Healthy Munchies", "Gifting & Hampers"],
  },
  {
    slug: "woman-axis",
    name: "Woman Axis",
    note: "Categories given verbatim in the brief.",
    categories: [
      "Daily Vitamin",
      "Sleep Support",
      "Stress Relief",
      "Weight Management",
      "Skin, Nail & Hair",
      "Energy Gummies",
      "PMS & Menopause",
      "Digestive Gummies",
    ],
  },
  {
    slug: "kids-vault",
    name: "Kids Vault",
    note: "Categories given verbatim in the brief.",
    categories: ["Multivitamin", "Immunity", "Eye Care", "Memory & Brain Focus", "Calcium + D3"],
  },
  {
    slug: "man-rituals",
    name: "Man Rituals",
    note: "Categories given verbatim in the brief.",
    categories: ["Men Vitality", "Multivitamin", "Hair Fall"],
  },
  {
    // Reserved slot only. Inactive so it cannot surface in navigation.
    // The name is deliberately the regulator's category term, not a product
    // name — "energy drink" is the term FSSAI directed off packaging and
    // marketing, and the real brand name is the business's to choose.
    slug: "caffeinated-beverage-line",
    name: "Caffeinated Beverage Line (unnamed)",
    isActive: false,
    note: "RESERVED SLOT — do not add products. Product name, formulation and caffeine level are unresolved (Section 14). Must not launch under the term 'energy drink'.",
    categories: [],
  },
  {
    slug: "healthy-beverages",
    name: "Healthy Beverages (undefined)",
    isActive: false,
    note: "RESERVED SLOT — prebiotic/fibre line, explicitly work in progress. No categories until the business defines them.",
    categories: [],
  },
];

async function main() {
  console.log("Seeding SooulOne brands and categories…\n");

  for (const brand of BRANDS) {
    const record = await prisma.brand.upsert({
      where: { slug: brand.slug },
      // `note` is for whoever reads this file, never for shoppers: `description`
      // is the brand page's visible intro and its search-result description.
      // It stays empty until the business writes one (the page falls back to
      // generic copy), and re-seeding clears a note an older seed wrote there.
      update: {
        name: brand.name,
        isRetailBrand: brand.isRetailBrand ?? false,
        isActive: brand.isActive ?? true,
        description: null,
      },
      create: {
        slug: brand.slug,
        name: brand.name,
        tagline: brand.tagline,
        colorToken: PLACEHOLDER_COLOR,
        isRetailBrand: brand.isRetailBrand ?? false,
        isActive: brand.isActive ?? true,
      },
    });

    const status = (brand.isActive ?? true) ? "" : "  [reserved, inactive]";
    console.log(`  ${brand.name}${status}`);
    if (brand.note) console.log(`    note: ${brand.note}`);

    for (const [index, name] of brand.categories.entries()) {
      await prisma.category.upsert({
        where: { brandId_slug: { brandId: record.id, slug: toSlug(name) } },
        update: { name, sortOrder: index },
        create: { brandId: record.id, slug: toSlug(name), name, sortOrder: index },
      });
      console.log(`      - ${name}`);
    }

    if (brand.categories.length === 0) {
      console.log("      (no categories — awaiting the business)");
    }
  }

  const brands = await prisma.brand.count();
  const categories = await prisma.category.count();
  const products = await prisma.product.count();

  console.log(`\nDone. ${brands} brands, ${categories} categories, ${products} products.`);
  console.log(
    "Products are intentionally not seeded: nutrition, allergen and dosing data\n" +
      "carry legal weight and must come from formulation records (Section 14).",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
