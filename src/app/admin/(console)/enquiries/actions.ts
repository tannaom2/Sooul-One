"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";

/** Mark a contact-form message handled (or back to new). */
export async function setEnquiryHandled(id: string, handled: boolean): Promise<void> {
  const session = await requirePermission("enquiries:manage");
  if (!session) throw new Error("Not authorized.");
  const row = await db.enquiry.findUnique({ where: { id }, select: { status: true, kind: true } });
  if (!row || (row.status === "HANDLED") === handled) return;
  await db.enquiry.update({
    where: { id },
    data: handled ? { status: "HANDLED", handledBy: session.email, handledAt: new Date() } : { status: "NEW", handledBy: null, handledAt: null },
  });
  await audit(session, handled ? "HANDLE_ENQUIRY" : "REOPEN_ENQUIRY", "Enquiry", id, { kind: row.kind });
  revalidatePath("/admin/enquiries");
}

/** Delete a message for good, e.g. spam or on the sender's request. */
export async function deleteEnquiry(id: string): Promise<void> {
  const session = await requirePermission("enquiries:manage");
  if (!session) throw new Error("Not authorized.");
  const row = await db.enquiry.findUnique({ where: { id }, select: { kind: true } });
  if (!row) return;
  await db.enquiry.delete({ where: { id } });
  await audit(session, "DELETE_ENQUIRY", "Enquiry", id, { kind: row.kind });
  revalidatePath("/admin/enquiries");
}
