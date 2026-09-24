import "server-only";
import { db } from "./db";
import type { AnalyticsEventType, Prisma } from "@prisma/client";
import { reportError } from "@/lib/observability";

/**
 * Funnel and abandonment event recording.
 *
 * Fire-and-forget by design: instrumentation must never be able to break the
 * request it's attached to. A shopper placing an order does not care that an
 * analytics insert failed, and should never see a 500 because of it — the
 * same principle src/lib/email.ts applies to confirmation emails.
 */
export async function recordEvent(
  sessionId: string,
  type: AnalyticsEventType,
  data: { productId?: string; orderId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await db.analyticsEvent.create({
      data: {
        sessionId,
        type,
        productId: data.productId,
        orderId: data.orderId,
        metadata: data.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    reportError("analytics", error, { type });
  }
}
