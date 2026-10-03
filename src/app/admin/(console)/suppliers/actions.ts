"use server";

import { revalidatePath } from "next/cache";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { diffFields } from "@/lib/audit-diff";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";
import { supplierSchema } from "@/lib/suppliers";
import { saveSupplier } from "@/server/suppliers";

export interface SupplierResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const date = (raw: FormDataEntryValue | null) => {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Add or update a supplier (src/server/suppliers.ts). Product pages show its licence, so the catalogue refreshes. */
export async function saveSupplierAction(_prev: SupplierResult, form: FormData): Promise<SupplierResult> {
  const session = await requirePermission("batches:write");
  if (!session) return { ok: false, message: "Your role can't change suppliers." };
  const id = String(form.get("id") ?? "") || null;
  const expires = date(form.get("licenceExpiresOn"));
  if (expires === undefined) return { ok: false, message: "Check the expiry date.", fieldErrors: { licenceExpiresOn: "Enter a real date." } };
  const typeRaw = String(form.get("licenceType") ?? "");
  const parsed = supplierSchema.safeParse({
    name: String(form.get("name") ?? ""),
    address: String(form.get("address") ?? ""),
    fssaiLicence: String(form.get("fssaiLicence") ?? ""),
    licenceType: typeRaw === "" ? null : typeRaw,
    licenceExpiresOn: expires,
    gstin: String(form.get("gstin") ?? ""),
    contactName: String(form.get("contactName") ?? ""),
    contactPhone: String(form.get("contactPhone") ?? ""),
    contactEmail: String(form.get("contactEmail") ?? ""),
    notes: String(form.get("notes") ?? ""),
    isActive: id ? form.get("isActive") === "on" : true,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  const before = id ? await db.supplier.findUnique({ where: { id } }) : null;
  if (id && !before) return { ok: false, message: "That supplier no longer exists. Reload the page." };
  const result = await saveSupplier(id, parsed.data);
  if (!result.ok) return { ok: false, message: result.message, fieldErrors: result.field ? { [result.field]: result.message } : undefined };
  const changes = diffFields((before ?? {}) as Record<string, unknown>, parsed.data as unknown as Record<string, unknown>);
  await audit(session, id ? "UPDATE_SUPPLIER" : "CREATE_SUPPLIER", "Supplier", result.id, changes);
  expireTag(CATALOG_TAG);
  revalidatePath("/admin/suppliers");
  return { ok: true, message: id ? "Saved." : "Supplier added." };
}
