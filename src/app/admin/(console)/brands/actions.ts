"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { diffFields } from "@/lib/audit-diff";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";
import { brandSettingsSchema } from "@/lib/validation/site-content";
import { normalizeHost } from "@/lib/brand-domains";

export interface FormResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * A brand's tagline, description, social links and own domain. Owner only:
 * the domain setting changes what a whole website does.
 */
export async function saveBrand(_prev: FormResult, form: FormData): Promise<FormResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: "Only the owner can change brand settings." };

  const id = String(form.get("id") ?? "");
  const field = (n: string) => String(form.get(n) ?? "");
  const parsed = brandSettingsSchema.safeParse({
    tagline: field("tagline"),
    description: field("description"),
    domain: field("domain"),
    domainMode: field("domainMode") || "OFF",
    instagramUrl: field("instagramUrl"),
    facebookUrl: field("facebookUrl"),
    xUrl: field("xUrl"),
    youtubeUrl: field("youtubeUrl"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  const data = parsed.data;

  // The main site's own address can't be a brand domain: it would send the whole store away.
  const main = normalizeHost(URL.canParse(process.env.SITE_URL ?? "") ? new URL(process.env.SITE_URL!).host : "");
  if (data.domain && data.domain === main) return { ok: false, message: "That's the main site's address.", fieldErrors: { domain: "Use the brand's own domain, not the main site's." } };

  const before = await db.brand.findUnique({ where: { id } });
  if (!before) return { ok: false, message: "That brand no longer exists. Reload the page." };
  try {
    await db.brand.update({ where: { id }, data });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") return { ok: false, message: "Another brand already uses that domain.", fieldErrors: { domain: "Already used by another brand." } };
    throw error;
  }
  const changes = diffFields(before as unknown as Record<string, unknown>, data);
  if (Object.keys(changes).length) await audit(session, "UPDATE_BRAND", "Brand", id, changes);
  expireTag(CATALOG_TAG);
  revalidatePath("/admin/brands");
  const domainNote = before.domainMode !== data.domainMode || before.domain !== data.domain ? " Domain changes reach every server within a minute." : "";
  return { ok: true, message: Object.keys(changes).length ? `Saved.${domainNote}` : "No change." };
}
