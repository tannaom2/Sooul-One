import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { BUSINESS_TAG, CATALOG_TAG } from "@/lib/cache-tags";
import { getBusinessProfile } from "@/server/business";
import { onlinePaymentsEnabled } from "@/lib/payments-config";
import { DRAFT_POLICIES } from "@/lib/policy-status";
import { LIVE_REQUIRED } from "@/lib/validation/product";
import {
  evaluateReadiness,
  gateEnforced,
  looksLikeTestAccount,
  regionFromDatabaseUrl,
  type Readiness,
} from "@/lib/launch-readiness";

/** Gather the facts and judge them (src/lib/launch-readiness.ts). */
export async function getReadiness(): Promise<Readiness> {
  const [business, products, admins] = await Promise.all([
    getBusinessProfile(),
    db.product.findMany({
      where: { isActive: true },
      select: {
        name: true,
        manufacturerName: true,
        manufacturerAddress: true,
        countryOfOrigin: true,
        netQuantity: true,
        mrp: true,
        ingredients: true,
        hsnCode: true,
        _count: { select: { images: true } },
      },
    }),
    db.adminUser.findMany({ where: { isActive: true }, select: { email: true, role: true } }),
  ]);

  return evaluateReadiness({
    business,
    draftPolicies: DRAFT_POLICIES,
    liveProducts: products.length,
    liveProductsMissingDeclarations: products
      .filter((p) => LIVE_REQUIRED.some(([field]) => p[field] == null || p[field] === ""))
      .map((p) => p.name),
    liveProductsWithoutPhotos: products.filter((p) => p._count.images === 0).map((p) => p.name),
    emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    cronConfigured: Boolean(process.env.CRON_SECRET),
    onlinePayments: onlinePaymentsEnabled(),
    errorMonitoring: Boolean(process.env.SENTRY_DSN),
    databaseRegion: regionFromDatabaseUrl(process.env.DATABASE_URL),
    testAdmins: admins.filter((a) => looksLikeTestAccount(a.email)).map((a) => a.email),
    activeOwners: admins.filter((a) => a.role === "OWNER").length,
  });
}

/**
 * Whether the storefront takes orders. Always on in development, CI and local
 * tests; on the public site only once every blocking checklist item is done.
 * Checked by the checkout page and again by create-order.
 */
export async function ordersOpen(): Promise<boolean> {
  if (!gateEnforced(process.env.SITE_URL, process.env.LAUNCH_GATE)) return true;
  return (await blockerCount()) === 0;
}

// Cached for a minute: checkout asks on every visit, and the answer changes
// only when the owner finishes a checklist item. Catalogue and business-detail
// saves expire it at once.
const blockerCount = unstable_cache(async () => (await getReadiness()).blockers.length, ["launch-blockers"], {
  revalidate: 60,
  tags: [CATALOG_TAG, BUSINESS_TAG],
});
