"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";
import { decimalToPaise } from "@/lib/format";
import { BOX_KINDS, TRUE_STORE_SLUG, boxMargin, type BoxKind } from "@/lib/checkout/boxes";
import { GUMMY_BRANDS } from "@/lib/gummy-brands";
import { refreshBoxPool } from "@/server/boxes";
import type { ActionResult } from "../actions";

/**
 * Make Your Own Box, in the console. A box is a Box of Gummies or a True Store
 * box, chosen once when it's made; it takes that type's products, narrowed by
 * a price range (and, under Advanced, to stock worth clearing). The owner
 * unticks any product to keep it out. Every change is logged. A box can't go
 * live if it could sell below cost, unless the owner ticks the clearance
 * override (which is logged too).
 */

const NOT_ALLOWED = "Your session expired or you don't have access. Sign in again.";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function done(boxId?: string) {
  revalidatePath("/admin/boxes");
  if (boxId) revalidatePath(`/admin/boxes/${boxId}`);
  revalidatePath("/cart");
  expireTag(CATALOG_TAG);
}

const money = z.coerce.number().min(1).max(100_000);
const detailsSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(300).optional(),
  price: money,
  size: z.coerce.number().int().min(2).max(10),
  maxPerProduct: z.coerce.number().int().min(1).max(5),
});

const optionalInt = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(0).max(3650).nullable());
const optionalMoney = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).max(100_000).nullable());
const rulesSchema = z.object({
  minPrice: optionalMoney,
  maxPrice: optionalMoney,
  mode: z.enum(["ALL", "CLEARANCE"]).default("ALL"),
  nearExpiryDays: optionalInt,
  minDaysOfCover: optionalInt,
});
type Rules = z.infer<typeof rulesSchema>;

function rulesProblem(r: Rules): string | null {
  if (r.minPrice != null && r.maxPrice != null && r.minPrice > r.maxPrice) return "The lowest price is above the highest.";
  if (r.mode === "CLEARANCE" && r.nearExpiryDays == null && r.minDaysOfCover == null) {
    return "Only-clearance needs a near-cut-off window, a days-of-stock threshold, or both.";
  }
  return null;
}

/** The brands a box type takes: the three gummies brands, or The True Store. */
async function brandIdsFor(kind: BoxKind): Promise<string[]> {
  const slugs: string[] = kind === "GUMMIES" ? GUMMY_BRANDS.map((b) => b.slug) : [TRUE_STORE_SLUG];
  const brands = await db.brand.findMany({ where: { slug: { in: slugs } }, select: { id: true } });
  return brands.map((b) => b.id);
}

export async function createBox(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("bundles:write");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  const kind = BOX_KINDS.find((k) => k.kind === form.get("kind"))?.kind;
  if (!kind) return { ok: false, message: "Choose the box type: Box of Gummies or The True Store." };
  const parsed = detailsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Give the box a name, a price, and how many items make a box (2–10)." };
  const rules = rulesSchema.safeParse(Object.fromEntries(form));
  if (!rules.success) return { ok: false, message: "Check the price range: whole rupees, or leave it empty." };
  const problem = rulesProblem(rules.data);
  if (problem) return { ok: false, message: problem };

  const box = await db.box.create({
    data: {
      name: parsed.data.name,
      kind,
      slug: `${slugify(parsed.data.name)}-${Date.now().toString(36).slice(-4)}`,
      description: parsed.data.description || null,
      price: parsed.data.price,
      size: parsed.data.size,
      maxPerProduct: parsed.data.maxPerProduct,
      isActive: false,
      // One rule for the whole box; the shopper filters by sub-brand or category.
      slots: { create: [{ label: "Pick any", sortOrder: 0, brandIds: await brandIdsFor(kind), ...rules.data }] },
    },
  });
  await audit(session, "CREATE_BOX", "Box", box.id, { ...parsed.data, kind, ...rules.data });
  await refreshBoxPool(box.id);
  done(box.id);
  redirect(`/admin/boxes/${box.id}`);
}

export async function saveBoxDetails(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("bundles:write");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  const boxId = String(form.get("boxId") ?? "");
  const parsed = detailsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Check the name, price and box size (2–10)." };
  const before = await db.box.findUnique({ where: { id: boxId } });
  if (!before) return { ok: false, message: "That box no longer exists." };

  const allowBelowCost = form.get("allowBelowCost") === "on";
  await db.box.update({
    where: { id: boxId },
    data: { ...parsed.data, description: parsed.data.description || null, allowBelowCost },
  });
  await audit(session, "UPDATE_BOX", "Box", boxId, {
    price: { from: Number(before.price), to: parsed.data.price },
    size: { from: before.size, to: parsed.data.size },
    maxPerProduct: { from: before.maxPerProduct, to: parsed.data.maxPerProduct },
    allowBelowCost: { from: before.allowBelowCost, to: allowBelowCost },
  });
  done(boxId);
  return { ok: true, message: "Saved." };
}

/** Which of the box type's products it takes: a price range, and optionally only stock worth clearing. */
export async function saveBoxRules(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("bundles:write");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  const boxId = String(form.get("boxId") ?? "");
  const parsed = rulesSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Check the numbers: whole rupees and days, or leave them empty." };
  const problem = rulesProblem(parsed.data);
  if (problem) return { ok: false, message: problem };
  const box = await db.box.findUnique({ where: { id: boxId }, select: { slots: { select: { id: true } } } });
  if (!box) return { ok: false, message: "That box no longer exists." };
  await db.boxSlot.updateMany({ where: { boxId }, data: parsed.data });
  await audit(session, "UPDATE_BOX_RULES", "Box", boxId, parsed.data);
  const pool = await refreshBoxPool(boxId);
  done(boxId);
  return { ok: true, message: `Saved. ${pool.inPool} products fit the rule.` };
}

export async function refreshPool(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("bundles:write");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  const boxId = String(form.get("boxId") ?? "");
  const pool = await refreshBoxPool(boxId);
  await audit(session, "REFRESH_BOX_POOL", "Box", boxId, { inPool: pool.inPool });
  done(boxId);
  return { ok: true, message: `Pool refreshed: ${pool.inPool} products.` };
}

/**
 * The product checklist: every product the rule takes, ticked if it's in the
 * box. Unticked ones stay out through refreshes until they're ticked again.
 */
export async function saveBoxProducts(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("bundles:write");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  const boxId = String(form.get("boxId") ?? "");
  const ticked = new Set(form.getAll("productId").map(String));
  const rows = await db.boxProduct.findMany({ where: { boxId }, select: { id: true, productId: true, excluded: true } });
  const keepOut = rows.filter((r) => !r.excluded && !ticked.has(r.productId));
  const letIn = rows.filter((r) => r.excluded && ticked.has(r.productId));
  if (keepOut.length === 0 && letIn.length === 0) return { ok: true, message: "No changes." };
  await db.$transaction([
    db.boxProduct.updateMany({ where: { id: { in: keepOut.map((r) => r.id) } }, data: { excluded: true } }),
    db.boxProduct.updateMany({ where: { id: { in: letIn.map((r) => r.id) } }, data: { excluded: false } }),
  ]);
  await audit(session, "UPDATE_BOX_PRODUCTS", "Box", boxId, {
    keptOut: keepOut.map((r) => r.productId),
    letBackIn: letIn.map((r) => r.productId),
  });
  done(boxId);
  const parts = [keepOut.length && `${keepOut.length} kept out`, letIn.length && `${letIn.length} back in`].filter(Boolean);
  return { ok: true, message: `Saved: ${parts.join(", ")}.` };
}

/** Live or not. Going live checks the pool can fill a box and the box can't sell below cost. */
export async function setBoxLive(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("bundles:write");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  const boxId = String(form.get("boxId") ?? "");
  const live = form.get("live") === "true";
  const box = await db.box.findUnique({
    where: { id: boxId },
    include: { products: { where: { excluded: false }, include: { product: { select: { basePrice: true, unitCost: true } } } } },
  });
  if (!box) return { ok: false, message: "That box no longer exists." };

  if (live) {
    const margin = boxMargin(
      decimalToPaise(box.price),
      box.size,
      box.maxPerProduct,
      box.products.map((p) => ({
        listPaise: decimalToPaise(p.product.basePrice),
        costPaise: p.product.unitCost == null ? null : decimalToPaise(p.product.unitCost),
      })),
    );
    if (margin.tooSmall) return { ok: false, message: `The pool can't fill a box of ${box.size}. Widen the price range or tick more products.` };
    if (margin.maxValuePaise > 0 && margin.maxValuePaise < decimalToPaise(box.price)) {
      return { ok: false, message: "Every possible box costs less than its price bought item by item, so the box would never save anything." };
    }
    if (margin.worstMarginPaise != null && margin.worstMarginPaise < 0 && !box.allowBelowCost) {
      return { ok: false, message: `The dearest box would sell ${toRupees(-margin.worstMarginPaise)} below cost. Raise the price, narrow the pool, or tick the clearance override.` };
    }
  }
  await db.box.update({ where: { id: boxId }, data: { isActive: live } });
  await audit(session, live ? "ACTIVATE_BOX" : "DEACTIVATE_BOX", "Box", boxId, { isActive: { from: !live, to: live } });
  done(boxId);
  return { ok: true, message: live ? "The box is live on the storefront." : "The box is off the storefront." };
}

function toRupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

export async function deleteBox(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("bundles:write");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  const boxId = String(form.get("boxId") ?? "");
  const box = await db.box.findUnique({ where: { id: boxId }, include: { slots: true } });
  if (!box) return { ok: false, message: "That box no longer exists." };
  // Baskets holding it lose the box; their shoppers see it gone, not mispriced.
  await db.box.delete({ where: { id: boxId } });
  await audit(session, "DELETE_BOX", "Box", boxId, {
    deleted: { name: box.name, price: Number(box.price), size: box.size, sections: box.slots.map((s) => s.label) },
  });
  done();
  redirect("/admin/boxes");
}

