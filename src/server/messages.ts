import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recordOrderEvent } from "@/lib/order-events";
import { reportError } from "@/lib/observability";
import { LOCK_MINUTES, isMessageKind, outcomeOf, type MessageKind, type Outcome } from "@/lib/messages";

export { messageKey } from "@/lib/messages";
import { SENDERS } from "@/server/message-senders";

/**
 * The message queue (benchmark gap M11).
 *
 * A message is written down first (enqueueMessage, inside the same
 * transaction as what causes it where there is one) and sent by
 * processMessages, which claims due messages so two workers never send the
 * same one, sends each, and either marks it sent, schedules a retry with
 * backoff (src/lib/messages.ts), or gives up. Callers usually deliver their
 * own message straight away (deliverNow); the /api/cron/messages job is the
 * backstop that sends retries and anything a crashed request left behind.
 *
 * Every send that ends (sent, skipped, given up) goes on the order's timeline
 * as before, so the console reads the same.
 */

/** The client, or a transaction on it (the message is then written with what causes it). */
type Client = Pick<typeof db, "outboundMessage">;

export interface NewMessage {
  readonly kind: MessageKind;
  /** One message per key: enqueueing the same key again does nothing. */
  readonly dedupeKey: string;
  readonly orderId?: string | null;
  /** Ids the sender needs. Never message text or contact details. */
  readonly payload?: Record<string, string | number | boolean | null>;
  /** Not before this time (a reminder due later). Default: now. */
  readonly sendAfter?: Date;
}

/** Write messages down to send. Safe to call twice: a key already queued is left as it is. */
/** Returns how many were newly queued: one already queued under the same key is skipped. */
export async function enqueueMessage(client: Client, ...messages: NewMessage[]): Promise<number> {
  if (messages.length === 0) return 0;
  const { count } = await client.outboundMessage.createMany({
    data: messages.map((m) => ({
      kind: m.kind,
      dedupeKey: m.dedupeKey,
      orderId: m.orderId ?? null,
      payload: (m.payload ?? {}) as Prisma.InputJsonObject,
      ...(m.sendAfter && { sendAfter: m.sendAfter }),
    })),
    skipDuplicates: true,
  });
  return count;
}

export interface Processed {
  readonly id: string;
  readonly dedupeKey: string;
  readonly kind: string;
  readonly outcome: Outcome;
}

interface Claimed {
  id: string;
  kind: string;
  dedupeKey: string;
  payload: unknown;
  orderId: string | null;
  attempts: number;
}

/**
 * Send what's due: up to `limit` messages, or only the given keys. A message
 * another worker holds is skipped; one whose holder crashed (its hold ran out)
 * is taken over. Never throws.
 */
export async function processMessages(options: { dedupeKeys?: readonly string[]; limit?: number } = {}): Promise<Processed[]> {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000);
  const only = options.dedupeKeys?.length ? Prisma.sql`AND "dedupeKey" IN (${Prisma.join([...options.dedupeKeys])})` : Prisma.empty;
  let claimed: Claimed[];
  try {
    claimed = await db.$queryRaw<Claimed[]>`
      UPDATE "OutboundMessage"
         SET status = 'SENDING', "lockedUntil" = ${lockUntil}, attempts = attempts + 1, "updatedAt" = ${now}
       WHERE id IN (
         SELECT id FROM "OutboundMessage"
          WHERE ((status = 'PENDING' AND "sendAfter" <= ${now}) OR (status = 'SENDING' AND "lockedUntil" < ${now})) ${only}
          ORDER BY "sendAfter"
          LIMIT ${options.limit ?? 25}
          FOR UPDATE SKIP LOCKED)
      RETURNING id, kind, "dedupeKey", payload, "orderId", attempts`;
  } catch (error) {
    reportError("messages/claim", error);
    return [];
  }

  const results: Processed[] = [];
  for (const m of claimed) results.push(await sendOne(m));
  return results;
}

async function sendOne(m: Claimed): Promise<Processed> {
  let result;
  try {
    if (!isMessageKind(m.kind)) throw new Error(`unknown message kind ${m.kind}`);
    const payload = m.payload && typeof m.payload === "object" ? (m.payload as Record<string, unknown>) : {};
    result = await SENDERS[m.kind](payload, m.orderId);
  } catch (error) {
    reportError("messages/send", error, { kind: m.kind });
    result = { delivered: false, reason: `exception: ${error instanceof Error ? error.message : String(error)}` };
  }
  const now = new Date();
  const outcome = outcomeOf(result, m.attempts, now);
  try {
    // Only if still ours: cancelled from the console meanwhile stays cancelled.
    await db.outboundMessage.updateMany({
      where: { id: m.id, status: "SENDING" },
      data:
        outcome.status === "SENT"
          ? { status: "SENT", sentAt: now, lockedUntil: null, lastError: null }
          : outcome.status === "PENDING"
            ? { status: "PENDING", sendAfter: outcome.retryAt, lockedUntil: null, lastError: outcome.reason }
            : { status: outcome.status, lockedUntil: null, lastError: outcome.reason },
    });
    // The order's timeline records how it ended, not each retry.
    if (m.orderId && outcome.status !== "PENDING") {
      await recordOrderEvent(m.orderId, "EMAIL_SENT", { type: "SYSTEM" }, {
        email: m.kind,
        delivered: outcome.status === "SENT",
        reason: outcome.status === "SENT" ? null : outcome.reason,
        ...(m.attempts > 1 && { attempts: m.attempts }),
      });
    }
  } catch (error) {
    reportError("messages/record", error, { kind: m.kind });
  }
  return { id: m.id, dedupeKey: m.dedupeKey, kind: m.kind, outcome };
}

/** Queue these messages and send them now, for a caller that wants the result. Never throws. */
export async function deliverNow(...messages: NewMessage[]): Promise<Processed[]> {
  try {
    await enqueueMessage(db, ...messages);
  } catch (error) {
    reportError("messages/enqueue", error, { kinds: messages.map((m) => m.kind).join(",") });
    return [];
  }
  return processMessages({ dedupeKeys: messages.map((m) => m.dedupeKey) });
}

/** Sent, skipped and cancelled messages are kept this long for the console, then removed. */
export const KEEP_DAYS = 90;

export async function purgeOldMessages(now = new Date()): Promise<number> {
  const { count } = await db.outboundMessage.deleteMany({
    where: { status: { in: ["SENT", "SKIPPED", "CANCELLED"] }, createdAt: { lt: new Date(now.getTime() - KEEP_DAYS * 86_400_000) } },
  });
  return count;
}

