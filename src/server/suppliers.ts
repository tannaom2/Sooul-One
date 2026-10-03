import "server-only";
import { db } from "@/lib/db";
import { sendSupplierLicenceAlert } from "@/lib/email";
import { enqueueMessage } from "@/server/messages";
import { licenceReminderKey, licenceReminders, type SupplierInput } from "@/lib/suppliers";
import type { SendResult } from "@/lib/messages";
import { getBusinessProfile } from "@/server/business";

/**
 * Suppliers and their FSSAI licences (src/lib/suppliers.ts). Saving a
 * supplier schedules the owner's expiry reminders on the message queue
 * (src/server/messages.ts): 60 and 14 days before the licence expires. A
 * changed expiry date cancels the old reminders and schedules new ones.
 */

export type SaveSupplierResult = { ok: true; id: string } | { ok: false; message: string; field?: keyof SupplierInput };

export async function saveSupplier(id: string | null, input: SupplierInput, now = new Date()): Promise<SaveSupplierResult> {
  if (id) {
    // A licence can't be removed while live products show it on their pages.
    if (!input.fssaiLicence || !input.isActive) {
      const live = await db.product.count({ where: { isActive: true, OR: [{ manufacturerId: id }, { marketerId: id }] } });
      if (live > 0) {
        return {
          ok: false,
          field: input.isActive ? "fssaiLicence" : "isActive",
          message: `${live} live ${live === 1 ? "product names" : "products name"} this firm and show its licence number. Move ${live === 1 ? "it" : "them"} to another firm, or take ${live === 1 ? "it" : "them"} off sale, first.`,
        };
      }
    }
  }
  const saved = id ? await db.supplier.update({ where: { id }, data: input, select: { id: true } }) : await db.supplier.create({ data: input, select: { id: true } });
  await scheduleLicenceReminders(saved.id, input.isActive ? input.licenceExpiresOn : null, now);
  return { ok: true, id: saved.id };
}

/** Queue this licence's reminders, and cancel any waiting for an old expiry date. */
export async function scheduleLicenceReminders(supplierId: string, expiresOn: Date | null, now = new Date()): Promise<void> {
  const reminders = expiresOn ? licenceReminders(expiresOn, now) : [];
  const keys = reminders.map((r) => licenceReminderKey(supplierId, expiresOn!, r.daysBefore));
  await db.outboundMessage.updateMany({
    where: { kind: "supplier_licence_expiry", status: "PENDING", dedupeKey: { startsWith: `supplier_licence:${supplierId}:`, notIn: keys } },
    data: { status: "CANCELLED" },
  });
  if (!expiresOn) return;
  await enqueueMessage(
    db,
    ...reminders.map((r, i) => ({
      kind: "supplier_licence_expiry" as const,
      dedupeKey: keys[i],
      payload: { supplierId, expiresOn: expiresOn.toISOString().slice(0, 10), daysBefore: r.daysBefore },
      sendAfter: r.sendAfter,
    })),
  );
}

/** The queue's sender for supplier_licence_expiry (src/server/message-senders.ts). */
export async function sendLicenceReminder(payload: Record<string, unknown>, now = new Date()): Promise<SendResult> {
  const supplierId = typeof payload.supplierId === "string" ? payload.supplierId : null;
  const supplier = supplierId
    ? await db.supplier.findUnique({
        where: { id: supplierId },
        select: { name: true, fssaiLicence: true, licenceExpiresOn: true, isActive: true, _count: { select: { manufactured: { where: { isActive: true } }, marketed: { where: { isActive: true } } } } },
      })
    : null;
  if (!supplier) return { delivered: false, reason: "not_found" };
  // Renewed or changed since this was queued, or no longer bought from: nothing to say.
  const expiry = supplier.licenceExpiresOn?.toISOString().slice(0, 10);
  if (!supplier.isActive || !supplier.fssaiLicence || !expiry || expiry !== payload.expiresOn) return { delivered: false, reason: "not_due" };
  const to = process.env.OWNER_ALERT_EMAIL || (await getBusinessProfile()).customerCareEmail;
  if (!to) return { delivered: false, reason: "not_configured" };
  const site = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return sendSupplierLicenceAlert(to, {
    supplier: supplier.name,
    licence: supplier.fssaiLicence,
    expiresOn: supplier.licenceExpiresOn!,
    daysLeft: Math.ceil((supplier.licenceExpiresOn!.getTime() - now.getTime()) / 86_400_000),
    liveProducts: supplier._count.manufactured + supplier._count.marketed,
    consoleUrl: `${site}/admin/suppliers`,
  });
}
