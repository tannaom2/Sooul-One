"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { CONTENT_TAG, expireTag } from "@/lib/cache-tags";
import { SITE_TEXT, SITE_TEXT_KEYS, resolveSiteText, type SiteTextKey } from "@/lib/site-content";
import { siteTextSchema } from "@/lib/validation/site-content";

export interface FormResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Save the storefront's editable lines. A line saved as its default is
 * stored as "no override", so a better default later reaches the site; a
 * line saved empty is stored empty, which hides it.
 */
export async function saveSiteText(_prev: FormResult, form: FormData): Promise<FormResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: "Only the owner can change the site text." };

  const parsed = siteTextSchema().safeParse(Object.fromEntries(SITE_TEXT_KEYS.map((k) => [k, String(form.get(k) ?? "")])));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  const values = parsed.data as Record<SiteTextKey, string>;
  const before = resolveSiteText(await db.siteText.findMany());
  const changed = SITE_TEXT_KEYS.filter((k) => values[k] !== before[k]);
  if (changed.length === 0) return { ok: true, message: "No change." };

  await db.$transaction(
    changed.map((k) =>
      values[k] === SITE_TEXT[k].default
        ? db.siteText.deleteMany({ where: { key: k } })
        : db.siteText.upsert({ where: { key: k }, create: { key: k, value: values[k] }, update: { value: values[k] } }),
    ),
  );
  await audit(session, "UPDATE_SITE_TEXT", "SiteText", "storefront", Object.fromEntries(changed.map((k) => [k, { from: before[k], to: values[k] }])));
  expireTag(CONTENT_TAG);
  revalidatePath("/admin/site-text");
  return { ok: true, message: `Saved ${changed.length} ${changed.length === 1 ? "line" : "lines"}. The site shows them now.` };
}
