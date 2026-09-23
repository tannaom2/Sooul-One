"use server";

import { revalidatePath } from "next/cache";
import type { DiscountType } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import type { ActionResult } from "../actions";

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
  const minItems = Math.max(2, Number(form.get("minItems") ?? 2));
  const maxItemsRaw = form.get("maxItems");
  const maxItems = maxItemsRaw ? Number(maxItemsRaw) : null;
  const eligibleProductIds = form.getAll("eligibleProductIds").map(String);

  if (!name || !brandId) {
    return { ok: false, message: "A bundle needs a name and a brand." };
  }
  if (!["PERCENTAGE", "FLAT"].includes(discountType) || !Number.isFinite(discountValue) || discountValue <= 0) {
    return { ok: false, message: "Set a valid discount type and value." };
  }
  if (eligibleProductIds.length < 2) {
    return { ok: false, message: "Pick at least two eligible products — a bundle needs something to combine." };
  }

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
}
