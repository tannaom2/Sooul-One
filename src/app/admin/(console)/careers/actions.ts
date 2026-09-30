"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { CONTENT_TAG, expireTag } from "@/lib/cache-tags";
import { jobSchema } from "@/lib/validation/site-content";

export interface FormResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

/** Add or change an open role. With none published, the site hides careers altogether. */
export async function saveJob(_prev: FormResult, form: FormData): Promise<FormResult> {
  const session = await requirePermission("content:write");
  if (!session) return { ok: false, message: "Your role can't edit open roles." };

  const id = String(form.get("id") ?? "") || null;
  const field = (n: string) => String(form.get(n) ?? "");
  const parsed = jobSchema.safeParse({
    title: field("title"),
    team: field("team"),
    location: field("location"),
    employmentType: field("employmentType"),
    summary: field("summary"),
    applyUrl: field("applyUrl"),
    applyEmail: field("applyEmail"),
    sortOrder: field("sortOrder") || "0",
    published: form.get("published") === "on",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  const data = parsed.data;
  if (id) {
    if (!(await db.jobOpening.findUnique({ where: { id }, select: { id: true } }))) return { ok: false, message: "That role was removed. Reload the page." };
    await db.jobOpening.update({ where: { id }, data });
    await audit(session, "UPDATE_JOB", "JobOpening", id, { title: data.title, published: data.published });
  } else {
    const created = await db.jobOpening.create({ data });
    await audit(session, "ADD_JOB", "JobOpening", created.id, { title: data.title, published: data.published });
  }
  expireTag(CONTENT_TAG);
  revalidatePath("/admin/careers");
  return { ok: true, message: data.published ? "Saved and published on /careers." : "Saved as a draft." };
}

export async function deleteJob(id: string): Promise<void> {
  const session = await requirePermission("content:write");
  if (!session) throw new Error("Not authorized.");
  const row = await db.jobOpening.findUnique({ where: { id }, select: { title: true } });
  if (!row) return;
  await db.jobOpening.delete({ where: { id } });
  await audit(session, "REMOVE_JOB", "JobOpening", id, row);
  expireTag(CONTENT_TAG);
  revalidatePath("/admin/careers");
}
