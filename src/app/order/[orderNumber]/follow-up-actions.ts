"use server";

import { reportError } from "@/lib/observability";
import { stopFollowUps } from "@/server/follow-ups";
import { ownOrder } from "@/server/order-owner";
import type { RefillResult } from "./refill-actions";

/** "Stop these emails" from a check-in or review request (src/server/follow-ups.ts). */
export async function stopFollowUpEmails(orderNumber: string, token: string | null): Promise<RefillResult> {
  try {
    const order = await ownOrder(orderNumber, token);
    if (!order) return { ok: false, message: "That link doesn't match an order. Contact us and we'll stop them for you." };
    await stopFollowUps(order.id);
    return { ok: true, message: "Stopped. We won't send check-ins or review requests. Order updates still come." };
  } catch (error) {
    reportError("follow-ups/stop", error);
    return { ok: false, message: "That didn't save. Try again in a moment." };
  }
}
