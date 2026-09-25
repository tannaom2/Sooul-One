import "server-only";
import type { OrderEventActor as ActorType, OrderEventType, Prisma } from "@prisma/client";
import { db } from "./db";
import { reportError } from "@/lib/observability";

// Database enums, so a misspelt event type fails the build and the insert.
export type { OrderEventType };

export type OrderEventActor = { type: ActorType; email?: string | null };

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
    reportError("order-events", error, { orderId, type });
  }
}
