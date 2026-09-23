import { config } from "dotenv";

/**
 * Seeds one dedicated, idempotent product for the E2E suite to buy.
 *
 * Deliberately independent of whatever is already in the database — manually
 * created test products, a partial seed, or nothing at all. Every field a
 * real checkout needs (shelf life, a batch with plenty of remaining life,
 * positive stock) is set explicitly here so the suite never depends on
 * someone having set up data by hand first.
 *
 * Upserts on a fixed slug/sku, so re-running the suite doesn't pile up
 * duplicate rows or duplicate brands/categories.
 */
export const E2E_PRODUCT_SLUG = "e2e-test-product";
const E2E_SKU = "E2E-TEST-SKU";
const E2E_BRAND_SLUG = "e2e-test-brand";
const E2E_BATCH_NUMBER = "E2E-BATCH-001";

/**
 * Neon's free tier suspends its compute after a few minutes idle and takes a
 * handful of seconds to wake on the next query — long enough that the first
 * connection attempt after any gap (exactly the situation right as this suite
 * starts) reliably times out while the one after it succeeds. Retrying
 * instead of failing outright is the correct response to that, not a bug
 * being papered over: the database is not actually unreachable, just asleep.
 */
async function withColdStartRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  throw lastError;
}

export default async function globalSetup() {
  // Loaded here, not at module top level: static imports (including this
  // file's own eventual `import { db }`) all resolve before a module's own
  // top-level code runs, so setting DATABASE_URL before importing db.ts
  // requires deferring that import until after config() has actually run.
  config({ path: ".env.local" });
  const { db } = await import("../../src/lib/db");

  const brand = await withColdStartRetry(() =>
    db.brand.upsert({
      where: { slug: E2E_BRAND_SLUG },
      update: {},
      create: {
        slug: E2E_BRAND_SLUG,
        name: "E2E Test Brand",
        colorToken: "#6B7280",
        isActive: true,
      },
    }),
  );

  const category = await db.category.upsert({
    where: { brandId_slug: { brandId: brand.id, slug: "e2e-test-category" } },
    update: {},
    create: {
      brandId: brand.id,
      slug: "e2e-test-category",
      name: "E2E Test Category",
      isActive: true,
    },
  });

  const product = await db.product.upsert({
    where: { slug: E2E_PRODUCT_SLUG },
    update: {
      isActive: true,
      stockQuantity: 500,
      discountActive: false,
    },
    create: {
      sku: E2E_SKU,
      slug: E2E_PRODUCT_SLUG,
      name: "E2E Test Product — do not sell",
      brandId: brand.id,
      categoryId: category.id,
      regulatoryType: "PACKAGED_FOOD",
      shortDescription: "Fixture product for automated checkout tests.",
      description: "Fixture product for automated checkout tests. Not a real SKU.",
      basePrice: "199.00",
      taxRatePercent: "18",
      stockQuantity: 500,
      isActive: true,
      isVeg: true,
      shelfLifeDays: 365,
    },
  });

  // Long-dated batch, so the shelf-life-at-delivery rule never blocks the
  // line no matter how far away the test runs from the seed date.
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  const manufacturedToday = new Date();

  await db.productBatch.upsert({
    where: { productId_batchNumber: { productId: product.id, batchNumber: E2E_BATCH_NUMBER } },
    update: { quantityRemaining: 500, expiresOn: oneYearFromNow },
    create: {
      productId: product.id,
      batchNumber: E2E_BATCH_NUMBER,
      manufacturedOn: manufacturedToday,
      expiresOn: oneYearFromNow,
      quantityReceived: 500,
      quantityRemaining: 500,
    },
  });
}
