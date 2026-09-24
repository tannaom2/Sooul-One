"use server";

import { revalidatePath } from "next/cache";
import type { OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { diffFields } from "@/lib/audit-diff";
import { recordOrderEvent } from "@/lib/order-events";
import { productInputSchema } from "@/lib/validation/product";
import { sendShippingNotification } from "@/lib/email";

/**
 * Admin write actions.
 *
 * Every one of these re-checks the session server-side. Middleware and layout
 * guards are convenience; an action is directly callable and must defend
 * itself rather than assume something upstream already did.
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

function collect(issues: { path: PropertyKey[]; message: string }[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "_");
    (map[key] ??= []).push(issue.message);
  }
  return map;
}

function num(form: FormData, key: string): number | undefined {
  const raw = form.get(key);
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function json<T>(form: FormData, key: string): T | undefined {
  const raw = form.get(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return undefined;
  }
}

const NOT_ALLOWED = "You don't have access to do that. Sign in again, or ask the owner for access.";

/** True when any price-bearing field differs from what's stored. */
function pricingChanged(
  existing: { basePrice: unknown; compareAtPrice: unknown; discountActive: boolean; discountPercent: unknown; taxRatePercent: unknown },
  input: { basePrice: unknown; compareAtPrice?: unknown; discountActive: boolean; discountPercent?: unknown; taxRatePercent: unknown },
): boolean {
  const n = (v: unknown) => (v == null ? null : Number(String(v)));
  return (
    n(existing.basePrice) !== n(input.basePrice) ||
    n(existing.compareAtPrice) !== n(input.compareAtPrice) ||
    existing.discountActive !== input.discountActive ||
    n(existing.discountPercent) !== n(input.discountPercent) ||
    n(existing.taxRatePercent) !== n(input.taxRatePercent)
  );
}

export async function saveProduct(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("products:write");
  if (!session) return { ok: false, message: NOT_ALLOWED };

  const id = form.get("id") ? String(form.get("id")) : null;
  const regulatoryType = String(form.get("regulatoryType"));

  const candidate: Record<string, unknown> = {
    regulatoryType,
    sku: String(form.get("sku") ?? "").trim(),
    name: String(form.get("name") ?? "").trim(),
    slug: String(form.get("slug") ?? "").trim(),
    brandId: String(form.get("brandId") ?? ""),
    categoryId: String(form.get("categoryId") ?? ""),
    shortDescription: String(form.get("shortDescription") ?? "").trim(),
    description: String(form.get("description") ?? "").trim(),
    basePrice: String(form.get("basePrice") ?? "").trim(),
    compareAtPrice: form.get("compareAtPrice") ? String(form.get("compareAtPrice")) : undefined,
    discountActive: form.get("discountActive") === "on",
    discountPercent: num(form, "discountPercent"),
    hsnCode: form.get("hsnCode") ? String(form.get("hsnCode")) : undefined,
    taxRatePercent: num(form, "taxRatePercent") ?? 18,
    stockQuantity: num(form, "stockQuantity") ?? 0,
    lowStockThreshold: num(form, "lowStockThreshold") ?? 10,
    weightGrams: num(form, "weightGrams"),
    availableInRetail: form.get("availableInRetail") === "on",
    retailOnly: form.get("retailOnly") === "on",
    isVeg: form.get("isVeg") === "" ? undefined : form.get("isVeg") === "true",
    shelfLifeDays: num(form, "shelfLifeDays"),
    allergens: String(form.get("allergens") ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
  };

  if (regulatoryType === "PACKAGED_FOOD" || regulatoryType === "BEVERAGE") {
    candidate.nutritionFacts = json(form, "nutritionFacts");
  }
  if (regulatoryType === "HEALTH_SUPPLEMENT") {
    candidate.servingsPerContainer = num(form, "servingsPerContainer");
    candidate.dosageGuidance = String(form.get("dosageGuidance") ?? "").trim();
    candidate.supplementFacts = json(form, "supplementFacts");
    candidate.complianceReviewConfirmed = form.get("complianceReviewConfirmed") === "on";
    candidate.isActive = form.get("isActive") === "on";
  }

  const parsed = productInputSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Some required label information is missing or not allowed.",
      fieldErrors: collect(parsed.error.issues),
    };
  }
  const input = parsed.data;

  // The stored row as it was before this save — used by the pricing guard,
  // the supplement sign-off, and the audit diff.
  const before = id ? await db.product.findUnique({ where: { id } }) : null;
  if (id && !before) return { ok: false, message: "That product no longer exists." };

  // Copy editors (CONTENT) can change words but not money. Checked against
  // the stored row, not the form's claims about what changed.
  if (!can(session.role, "products:pricing")) {
    if (!before) return { ok: false, message: "Only the owner or a manager can create products, since that sets a price." };
    if (pricingChanged(before, input)) {
      return { ok: false, message: "You can edit this product's copy, but price, discount and GST changes need a manager." };
    }
  }

  const data: Record<string, unknown> = {
    sku: input.sku,
    name: input.name,
    slug: input.slug,
    brandId: input.brandId,
    categoryId: input.categoryId,
    regulatoryType: input.regulatoryType,
    shortDescription: input.shortDescription,
    description: input.description,
    basePrice: input.basePrice,
    compareAtPrice: input.compareAtPrice ?? null,
    discountActive: input.discountActive,
    // Kept when switched off so re-enabling a promotion doesn't need retyping.
    discountPercent: input.discountPercent ?? null,
    hsnCode: input.hsnCode ?? null,
    taxRatePercent: input.taxRatePercent,
    stockQuantity: input.stockQuantity,
    lowStockThreshold: input.lowStockThreshold,
    weightGrams: input.weightGrams ?? null,
    availableInRetail: input.availableInRetail,
    retailOnly: input.retailOnly,
    isVeg: input.isVeg,
    shelfLifeDays: input.shelfLifeDays,
    allergens: input.allergens,
  };

  if (input.regulatoryType === "PACKAGED_FOOD" || input.regulatoryType === "BEVERAGE") {
    data.nutritionFacts = input.nutritionFacts;
  }

  if (input.regulatoryType === "HEALTH_SUPPLEMENT") {
    data.servingsPerContainer = input.servingsPerContainer;
    data.dosageGuidance = input.dosageGuidance;
    data.supplementFacts = input.supplementFacts;
    data.isActive = input.isActive;

    /**
     * The sign-off is bound to the exact copy that was reviewed. If the
     * description changes after approval, the approval is void — otherwise an
     * edit could smuggle new claims in behind an old tick.
     */
    const copyChanged = !before || before.description !== input.description;

    data.complianceReviewedAt = input.complianceReviewConfirmed && !copyChanged
      ? (before?.complianceReviewedAt ?? new Date())
      : input.complianceReviewConfirmed
        ? new Date()
        : null;
    data.complianceReviewedBy = input.complianceReviewConfirmed ? session.email : null;
  }

  // `data` is built up field-by-field across the branches above, so its
  // static type is a loose Record — zod already validated its actual shape.
  const saved = id
    ? await db.product.update({ where: { id }, data: data as Prisma.ProductUpdateInput })
    : await db.product.create({ data: data as Prisma.ProductCreateInput });

  if (before) {
    // Only what actually changed — and nothing at all for a no-op save, so
    // the log stays a record of changes rather than of button presses.
    const changes = diffFields(before as unknown as Record<string, unknown>, data);
    if (Object.keys(changes).length > 0) await audit(session, "UPDATE_PRODUCT", "Product", saved.id, changes);
  } else {
    await audit(session, "CREATE_PRODUCT", "Product", saved.id, {
      name: input.name,
      sku: input.sku,
      basePrice: input.basePrice,
    });
  }

  revalidatePath("/admin/products");
  revalidatePath(`/product/${input.slug}`);

  return { ok: true, message: id ? "Product updated." : "Product created." };
}

/** Live preview of the claims check, so the writer sees it before saving. */
export async function addBatch(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("batches:write");
  if (!session) return { ok: false, message: NOT_ALLOWED };

  const productId = String(form.get("productId") ?? "");
  const batchNumber = String(form.get("batchNumber") ?? "").trim();
  const manufacturedOn = new Date(String(form.get("manufacturedOn")));
  const expiresOn = new Date(String(form.get("expiresOn")));
  const quantity = num(form, "quantityReceived") ?? 0;

  if (!productId || !batchNumber || quantity <= 0) {
    return { ok: false, message: "Enter a batch number and a quantity above zero." };
  }
  if (Number.isNaN(manufacturedOn.getTime()) || Number.isNaN(expiresOn.getTime())) {
    return { ok: false, message: "Enter both the manufacture and expiry dates." };
  }
  if (expiresOn <= manufacturedOn) {
    return { ok: false, message: "The expiry date must be after the manufacture date." };
  }

  const batch = await db.productBatch.create({
    data: {
      productId,
      batchNumber,
      manufacturedOn,
      expiresOn,
      quantityReceived: quantity,
      quantityRemaining: quantity,
    },
  });

  // Online stock is the sum of batches, so receiving stock raises both.
  await db.product.update({
    where: { id: productId },
    data: { stockQuantity: { increment: quantity } },
  });

  await audit(session, "ADD_BATCH", "ProductBatch", batch.id, { productId, batchNumber, quantity });
  revalidatePath("/admin/batches");

  return { ok: true, message: `Batch ${batchNumber} received.` };
}

export async function saveStore(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("stores:write");
  if (!session) return { ok: false, message: NOT_ALLOWED };

  const name = String(form.get("name") ?? "").trim();
  const city = String(form.get("city") ?? "").trim();
  if (!name || !city) return { ok: false, message: "A store needs at least a name and a city." };

  const store = await db.storeLocation.create({
    data: {
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      addressLine1: String(form.get("addressLine1") ?? ""),
      addressLine2: String(form.get("addressLine2") ?? "") || null,
      city,
      state: String(form.get("state") ?? ""),
      postalCode: String(form.get("postalCode") ?? ""),
      phone: String(form.get("phone") ?? "") || null,
      openingHours: String(form.get("openingHours") ?? "") || null,
      latitude: num(form, "latitude") ?? null,
      longitude: num(form, "longitude") ?? null,
    },
  });

  await audit(session, "CREATE_STORE", "StoreLocation", store.id, { name, city });
  revalidatePath("/admin/stores");
  revalidatePath("/stores");

  return { ok: true, message: `${name} added.` };
}

export async function setOrderStatus(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("orders:write");
  if (!session) return { ok: false, message: NOT_ALLOWED };

  const orderId = String(form.get("orderId") ?? "");
  const status = String(form.get("status") ?? "");
  const tracking = String(form.get("trackingNumber") ?? "").trim();

  const allowed: OrderStatus[] = ["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"];
  if (!allowed.includes(status as OrderStatus)) return { ok: false, message: "That status isn't available." };

  const previous = await db.order.findUnique({ where: { id: orderId } });
  if (!previous) return { ok: false, message: "That order no longer exists." };

  const updated = await db.order.update({
    where: { id: orderId },
    data: { status: status as OrderStatus, trackingNumber: tracking || undefined },
  });

  // Only on the transition INTO shipped, not on every save of an already
  // shipped order — otherwise correcting a typo in the tracking number would
  // email the customer all over again.
  const changes = diffFields(
    { status: previous.status, trackingNumber: previous.trackingNumber },
    { status, trackingNumber: tracking || previous.trackingNumber },
  );
  const admin = { type: "ADMIN" as const, email: session.email };
  if (Object.keys(changes).length > 0) {
    await recordOrderEvent(orderId, "STATUS_CHANGED", admin, changes);
    await audit(session, "SET_ORDER_STATUS", "Order", orderId, changes);
  }

  let mailed = "";
  if (status === "SHIPPED" && previous.status !== "SHIPPED") {
    const sent = await sendShippingNotification(updated);
    await recordOrderEvent(orderId, "EMAIL_SENT", { type: "SYSTEM" }, {
      email: "shipping_notification",
      delivered: sent.delivered,
      reason: sent.reason ?? null,
    });
    mailed = sent.delivered
      ? " Customer notified."
      : sent.reason === "not_configured"
        ? " Email isn't configured, so the customer wasn't notified."
        : " Couldn't email the customer — check the server log.";
  }
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin");

  return { ok: true, message: `Order marked ${status.toLowerCase()}.${mailed}` };
}

export async function addOrderNote(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("orders:write");
  if (!session) return { ok: false, message: NOT_ALLOWED };

  const orderId = String(form.get("orderId") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (!note) return { ok: false, message: "Write a note first." };
  if (note.length > 1000) return { ok: false, message: "Keep notes under 1,000 characters." };

  const order = await db.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!order) return { ok: false, message: "That order no longer exists." };

  await recordOrderEvent(orderId, "NOTE", { type: "ADMIN", email: session.email }, { note });
  await audit(session, "ADD_ORDER_NOTE", "Order", orderId, { note });
  revalidatePath(`/admin/orders/${orderId}`);

  return { ok: true, message: "Note added." };
}
