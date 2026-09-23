import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";

export type OrderEventType =
  | "PLACED"
  | "PAYMENT_CAPTURED"
  | "PAYMENT_FAILED"
  | "REFUNDED"
  | "STATUS_CHANGED"
  | "EMAIL_SENT"
  | "NOTE";

export type OrderEventActor = { type: "CUSTOMER" | "SYSTEM" | "ADMIN"; email?: string | null };

/**
 * Append an event to an order's timeline. Never throws: a timeline write
 * failing must not roll back a payment or a status change, the same rule
 * src/lib/email.ts follows — but it's logged, not swallowed silently.
 */
export async function recordOrderEvent(
  orderId: string,
  type: OrderEventType,
  actor: OrderEventActor,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.orderEvent.create({
      data: {
        orderId,
        type,
        actorType: actor.type,
        actorEmail: actor.email ?? null,
        detail: detail as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    console.error("[order-events] failed to record", { orderId, type }, error);
  }
}
