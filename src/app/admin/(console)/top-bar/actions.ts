"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { CONTENT_TAG, expireTag } from "@/lib/cache-tags";
import { announcementSchema } from "@/lib/validation/site-content";

export interface FormResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const MAX_MESSAGES = 8;

/** Add a top-bar message, or change one (id set). Owner only: it's on every page. */
export async function saveAnnouncement(_prev: FormResult, form: FormData): Promise<FormResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: "Only the owner can change the top bar." };

  const id = String(form.get("id") ?? "") || null;
  const parsed = announcementSchema.safeParse({
    text: String(form.get("text") ?? ""),
    href: String(form.get("href") ?? ""),
    enabled: form.get("enabled") === "on",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  const sortOrder = Math.max(0, Math.min(99, Math.trunc(Number(form.get("sortOrder") ?? 0)) || 0));
  const data = { text: parsed.data.text, href: parsed.data.href, enabled: parsed.data.enabled, sortOrder };

  if (id) {
    const before = await db.announcement.findUnique({ where: { id } });
    if (!before) return { ok: false, message: "That message was removed. Reload the page." };
    await db.announcement.update({ where: { id }, data });
    await audit(session, "UPDATE_TOP_BAR", "Announcement", id, { before: { text: before.text, enabled: before.enabled }, after: data });
  } else {
    if ((await db.announcement.count()) >= MAX_MESSAGES) return { ok: false, message: `The top bar holds at most ${MAX_MESSAGES} messages. Remove one first.` };
    const created = await db.announcement.create({ data });
    await audit(session, "ADD_TOP_BAR", "Announcement", created.id, data);
  }
  expireTag(CONTENT_TAG);
  revalidatePath("/admin/top-bar");
  return { ok: true, message: "Saved. The site shows it now." };
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const session = await requirePermission("settings:manage");
  if (!session) throw new Error("Not authorized.");
  const row = await db.announcement.findUnique({ where: { id } });
  if (!row) return;
  await db.announcement.delete({ where: { id } });
  await audit(session, "REMOVE_TOP_BAR", "Announcement", id, { text: row.text });
  expireTag(CONTENT_TAG);
  revalidatePath("/admin/top-bar");
}
