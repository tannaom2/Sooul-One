"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { diffFields } from "@/lib/audit-diff";
import { BUSINESS_TAG, expireTag } from "@/lib/cache-tags";
import { BUSINESS_FIELDS, businessProfileSchema } from "@/lib/validation/business";

export interface BusinessResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

/** Owner only: these details appear on every page and every tax invoice. */
export async function saveBusinessProfile(_prev: BusinessResult, form: FormData): Promise<BusinessResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: "Only the owner can change the business details." };

  const candidate: Record<string, string | undefined> = {};
  for (const { name } of BUSINESS_FIELDS) {
    const value = String(form.get(name) ?? "").trim();
    candidate[name] = value || undefined;
  }

  const parsed = businessProfileSchema.safeParse(candidate);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }

  // Blank means "not provided yet", stored as null so it reads as missing.
  const data = Object.fromEntries(BUSINESS_FIELDS.map(({ name }) => [name, parsed.data[name] ?? null]));
  const before = await db.businessProfile.findUnique({ where: { id: "default" } });
  await db.businessProfile.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });

  const changes = diffFields((before ?? {}) as Record<string, unknown>, data);
  if (Object.keys(changes).length > 0) await audit(session, "UPDATE_BUSINESS_PROFILE", "BusinessProfile", "default", changes);

  expireTag(BUSINESS_TAG);
  revalidatePath("/admin/business");
  return { ok: true, message: Object.keys(changes).length ? "Saved. The site shows the new details now." : "No change." };
}
