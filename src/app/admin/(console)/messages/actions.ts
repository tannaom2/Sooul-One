"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { processMessages } from "@/server/messages";

export interface MessageActionResult {
  ok: boolean;
  message: string;
}

/**
 * Send a failed or skipped message again, now: after fixing what stopped it
 * (email set up, an address corrected). It gets a fresh set of retries.
 */
export async function retryMessage(id: string): Promise<MessageActionResult> {
  const session = await requirePermission("orders:write");
  if (!session) return { ok: false, message: "You don't have access to this." };
  const { count } = await db.outboundMessage.updateMany({
    where: { id, status: { in: ["FAILED", "SKIPPED", "CANCELLED"] } },
    data: { status: "PENDING", attempts: 0, sendAfter: new Date(), lastError: null, lockedUntil: null },
  });
  if (count === 0) return { ok: false, message: "This message is already being sent or was sent." };
  const row = await db.outboundMessage.findUniqueOrThrow({ where: { id }, select: { kind: true, dedupeKey: true } });
  await audit(session, "RETRY_MESSAGE", "OutboundMessage", id, { kind: row.kind });
  const [done] = await processMessages({ dedupeKeys: [row.dedupeKey] });
  revalidatePath("/admin/messages");
  const status = done?.outcome.status;
  return status === "SENT"
    ? { ok: true, message: "Sent." }
    : status === "SKIPPED"
      ? { ok: false, message: "Not sent: still nothing to send to, or email isn't set up." }
      : { ok: false, message: "Didn't go yet. It will be retried automatically." };
}

/** Stop a message that hasn't gone yet (a retry waiting, or a reminder not yet due). */
export async function cancelMessage(id: string): Promise<MessageActionResult> {
  const session = await requirePermission("orders:write");
  if (!session) return { ok: false, message: "You don't have access to this." };
  const { count } = await db.outboundMessage.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", lockedUntil: null } });
  if (count === 0) return { ok: false, message: "Too late: it's being sent or already finished." };
  const row = await db.outboundMessage.findUniqueOrThrow({ where: { id }, select: { kind: true } });
  await audit(session, "CANCEL_MESSAGE", "OutboundMessage", id, { kind: row.kind });
  revalidatePath("/admin/messages");
  return { ok: true, message: "Cancelled." };
}
