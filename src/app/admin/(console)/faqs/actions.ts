"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { CONTENT_TAG, expireTag } from "@/lib/cache-tags";
import { faqSchema } from "@/lib/validation/site-content";

export interface FormResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

/** Add or change an FAQ. The Help page and the storefront assistant both answer from published ones. */
export async function saveFaq(_prev: FormResult, form: FormData): Promise<FormResult> {
  const session = await requirePermission("content:write");
  if (!session) return { ok: false, message: "Your role can't edit FAQs." };

  const id = String(form.get("id") ?? "") || null;
  const parsed = faqSchema.safeParse({
    question: String(form.get("question") ?? ""),
    answer: String(form.get("answer") ?? ""),
    topic: String(form.get("topic") ?? ""),
    brandId: String(form.get("brandId") ?? ""),
    sortOrder: String(form.get("sortOrder") ?? "0") || "0",
    published: form.get("published") === "on",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  const data = parsed.data;
  if (data.brandId && !(await db.brand.findUnique({ where: { id: data.brandId }, select: { id: true } }))) {
    return { ok: false, message: "That brand no longer exists.", fieldErrors: { brandId: "Pick a brand again." } };
  }

  if (id) {
    const before = await db.faqEntry.findUnique({ where: { id } });
    if (!before) return { ok: false, message: "That question was removed. Reload the page." };
    await db.faqEntry.update({ where: { id }, data });
    await audit(session, "UPDATE_FAQ", "FaqEntry", id, { question: data.question, published: { from: before.published, to: data.published } });
  } else {
    const created = await db.faqEntry.create({ data });
    await audit(session, "ADD_FAQ", "FaqEntry", created.id, { question: data.question, published: data.published });
  }
  expireTag(CONTENT_TAG);
  revalidatePath("/admin/faqs");
  return { ok: true, message: data.published ? "Saved and published." : "Saved as a draft. Shoppers don't see it yet." };
}

export async function deleteFaq(id: string): Promise<void> {
  const session = await requirePermission("content:write");
  if (!session) throw new Error("Not authorized.");
  const row = await db.faqEntry.findUnique({ where: { id }, select: { question: true } });
  if (!row) return;
  await db.faqEntry.delete({ where: { id } });
  await audit(session, "REMOVE_FAQ", "FaqEntry", id, row);
  expireTag(CONTENT_TAG);
  revalidatePath("/admin/faqs");
}
