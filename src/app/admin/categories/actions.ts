"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";
import { diffFields } from "@/lib/audit-diff";
import { categorySlug, checkCategory } from "@/lib/validation/category";

export interface CategoryResult {
  ok: boolean;
  message?: string;
}

/**
 * Adds a category to a brand, or edits one when an id is given. Switching a
 * category off takes every product in it off sale, including from baskets
 * (the sellable rule in src/lib/basket-rules.ts), so the message says how many.
 */
export async function saveCategory(_prev: CategoryResult, form: FormData): Promise<CategoryResult> {
  const session = await requirePermission("products:write");
  if (!session) return { ok: false, message: "You don't have access to edit categories." };

  const checked = checkCategory({
    name: String(form.get("name") ?? ""),
    description: String(form.get("description") ?? ""),
    sortOrder: String(form.get("sortOrder") ?? ""),
  });
  if (!checked.ok) return { ok: false, message: checked.message };
  const { name } = checked.value;
  const id = String(form.get("id") ?? "") || null;

  if (id) {
    const before = await db.category.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
    if (!before) return { ok: false, message: "That category no longer exists." };
    const clash = await db.category.findFirst({
      where: { brandId: before.brandId, name: { equals: name, mode: "insensitive" }, NOT: { id } },
      select: { id: true },
    });
    if (clash) return { ok: false, message: `This brand already has a category called "${name}".` };

    // The web address (slug) stays as created, so links to it keep working.
    const data = { ...checked.value, isActive: form.get("isActive") === "on" };
    await db.category.update({ where: { id }, data });
    const changes = diffFields(before as unknown as Record<string, unknown>, data);
    if (Object.keys(changes).length > 0) await audit(session, "UPDATE_CATEGORY", "Category", id, changes);
    expireTag(CATALOG_TAG);
    revalidatePath("/admin/categories");

    const products = before._count.products;
    if (!data.isActive && before.isActive && products > 0) {
      return { ok: true, message: `${name} switched off. Its ${products} product${products === 1 ? "" : "s"} left the shop and any baskets.` };
    }
    return { ok: true, message: `${name} saved.` };
  }

  const brandId = String(form.get("brandId") ?? "");
  const brand = await db.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true } });
  if (!brand) return { ok: false, message: "Choose the brand this category belongs to." };

  const slug = categorySlug(name);
  const taken = await db.category.findUnique({ where: { brandId_slug: { brandId, slug } }, select: { name: true } });
  if (taken) return { ok: false, message: `${brand.name} already has a category called "${taken.name}".` };

  let created: { id: string };
  try {
    created = await db.category.create({ data: { ...checked.value, brandId, slug } });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") {
      return { ok: false, message: `${brand.name} already has a category with that name.` };
    }
    throw error;
  }
  await audit(session, "CREATE_CATEGORY", "Category", created.id, { brand: brand.name, name });
  expireTag(CATALOG_TAG);
  revalidatePath("/admin/categories");
  return { ok: true, message: `${name} added to ${brand.name}.` };
}
