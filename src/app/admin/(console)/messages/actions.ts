"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { processMessages } from "@/server/messages";
import { sendDigestNow } from "@/server/digest";

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

/** The owner's daily summary email on or off (src/server/digest.ts). */
export async function setDailyDigest(on: boolean): Promise<MessageActionResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: "Only the owner can change this." };
  await db.storeSettings.upsert({ where: { id: "default" }, create: { id: "default", dailyDigest: Boolean(on) }, update: { dailyDigest: Boolean(on) } });
  await audit(session, "SET_DAILY_DIGEST", "StoreSettings", "default", { dailyDigest: Boolean(on) });
  revalidatePath("/admin/messages");
  return { ok: true, message: on ? "On: it comes each morning at 8." : "Off: no more daily summaries." };
}

/** "Send today's now": the summary as it stands, straight away, so the owner can see it. */
export async function sendDigestTest(): Promise<MessageActionResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: "Only the owner can do this." };
  // Its own key each minute, so it never stands in for the 8 am one.
  const [done] = await sendDigestNow(new Date(), `owner_digest:now:${Math.floor(Date.now() / 60_000)}`);
  revalidatePath("/admin/messages");
  const outcome = done?.outcome;
  if (outcome?.status === "SENT") return { ok: true, message: "Sent. Check your inbox." };
  if (outcome?.status === "SKIPPED" && outcome.reason === "not_configured") return { ok: false, message: "Email isn't set up on this server, so it wasn't sent (see the list below)." };
  if (outcome?.status === "SKIPPED" && outcome.reason === "no_recipient") return { ok: false, message: "No alert address: set Customer care email in Business details." };
  return { ok: false, message: done ? "It didn't go yet; it will be retried (see below)." : "Already sent this minute." };
}
