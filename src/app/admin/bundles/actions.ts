"use server";

import { revalidatePath } from "next/cache";
import type { DiscountType } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import type { ActionResult } from "../actions";
import { bundleOfferProblem } from "@/lib/validation/bundle";
import { decimalToPaise } from "@/lib/format";
import { resolveUnitPrice } from "@/lib/pricing";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";

/**
 * Bundle CRUD.
 *
 * The pricing side of bundles (src/lib/checkout/bundles.ts, wired into
 * src/lib/checkout/quote.ts and src/server/cart.ts) has existed since the
 * discount work — a bundle discount already applies correctly at checkout
 * the moment a `Bundle` row exists with `isActive: true`. What was missing
 * was any way to create that row without a database console, which is what
 * this file and the page it backs are for.
 */

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function saveBundle(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("bundles:write");
  if (!session) return { ok: false, message: "Your session expired. Sign in again." };

  const name = String(form.get("name") ?? "").trim();
  const brandId = String(form.get("brandId") ?? "");
  const discountType = String(form.get("discountType") ?? "") as DiscountType;
  const discountValue = Number(form.get("discountValue") ?? 0);
  const eligibleProductIds = form.getAll("eligibleProductIds").map(String);
  // A fixed combo needs every chosen product; mix-and-match needs any minItems of them.
  const fixed = form.get("fixedCombo") === "on";
  const minItems = fixed ? eligibleProductIds.length : Number(form.get("minItems") || 2);
  const maxItemsRaw = form.get("maxItems");
  const maxItems = fixed ? null : maxItemsRaw ? Number(maxItemsRaw) : null;

  if (!name || !brandId) {
    return { ok: false, message: "A bundle needs a name and a brand." };
  }
  // Prices as shoppers see them today, so a flat discount can be checked
  // against the cheapest bundle it could apply to.
  const eligible = await db.product.findMany({
    where: { id: { in: eligibleProductIds } },
    select: { basePrice: true, discountActive: true, discountPercent: true, brandId: true, name: true },
  });
  // The form narrows products to the brand; this is the guarantee, whatever is posted.
  const otherBrand = eligible.filter((p) => p.brandId !== brandId);
  if (otherBrand.length) {
    return { ok: false, message: `A bundle's products must all be from its brand. Remove: ${otherBrand.map((p) => p.name).join(", ")}.` };
  }
  const problem = bundleOfferProblem({
    discountType,
    discountValue,
    minItems,
    maxItems,
    eligiblePricesPaise: eligible.map(
      (p) =>
        resolveUnitPrice(decimalToPaise(p.basePrice), {
          active: p.discountActive,
          percent: p.discountPercent == null ? null : Number(p.discountPercent.toString()),
        }).pricePaise,
    ),
  });
  if (problem) return { ok: false, message: problem };

  const bundle = await db.bundle.create({
    data: {
      brandId,
      name,
      slug: `${slugify(name)}-${Date.now().toString(36)}`, // timestamp suffix: two bundles can share a name across brands/seasons
      description: String(form.get("description") ?? "") || null,
      minItems,
      maxItems,
      discountType,
      discountValue,
      isActive: true,
      eligibleProducts: { create: eligibleProductIds.map((productId) => ({ productId })) },
    },
  });

  await audit(session, "CREATE_BUNDLE", "Bundle", bundle.id, {
    name,
    discountType,
    discountValue,
    minItems,
    maxItems,
    eligibleProductIds,
  });
  revalidatePath("/admin/bundles");
  revalidatePath("/cart");
  // Product pages and cards show combo offers.
  expireTag(CATALOG_TAG);

  return { ok: true, message: `${name} created and live.` };
}

export async function toggleBundle(bundleId: string, isActive: boolean): Promise<void> {
  const session = await requirePermission("bundles:write");
  if (!session) throw new Error("Not authorized.");

  await db.bundle.update({ where: { id: bundleId }, data: { isActive } });
  await audit(session, isActive ? "ACTIVATE_BUNDLE" : "DEACTIVATE_BUNDLE", "Bundle", bundleId, {
    isActive: { from: !isActive, to: isActive },
  });
  revalidatePath("/admin/bundles");
  revalidatePath("/cart");
  // Product pages and cards show combo offers.
  expireTag(CATALOG_TAG);
}

export async function deleteBundle(bundleId: string): Promise<void> {
  const session = await requirePermission("bundles:write");
  if (!session) throw new Error("Not authorized.");

  // Snapshot before deleting: the log entry is the only record left of what
  // the bundle was, so it holds enough to recreate it.
  const bundle = await db.bundle.findUnique({ where: { id: bundleId }, include: { eligibleProducts: true } });
  if (!bundle) return;
  await db.bundle.delete({ where: { id: bundleId } });
  await audit(session, "DELETE_BUNDLE", "Bundle", bundleId, {
    deleted: {
      name: bundle.name,
      brandId: bundle.brandId,
      discountType: bundle.discountType,
      discountValue: Number(bundle.discountValue),
      minItems: bundle.minItems,
      maxItems: bundle.maxItems,
      isActive: bundle.isActive,
      eligibleProductIds: bundle.eligibleProducts.map((e) => e.productId),
    },
  });
  revalidatePath("/admin/bundles");
  revalidatePath("/cart");
  // Product pages and cards show combo offers.
  expireTag(CATALOG_TAG);
}
