"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { reportError } from "@/lib/observability";
import { optInRefill, refillStatus, stopRefill } from "@/server/refill-reminders";
import { ownOrder } from "@/server/order-owner";

export interface RefillResult {
  ok: boolean;
  message: string;
}

/** "Remind me before it runs out" on the order page (src/server/refill-reminders.ts). */
export async function askRefillReminder(orderNumber: string, token: string | null, email: string | null): Promise<RefillResult> {
  try {
    const order = await ownOrder(orderNumber, token);
    if (!order) return { ok: false, message: "That order couldn't be found." };
    const status = await refillStatus(order.id);
    if (!status.offer) return { ok: false, message: "A reminder isn't available for this order." };
    let address: string | null = null;
    if (!status.hasEmail) {
      const parsed = z.email().max(200).safeParse((email ?? "").trim());
      if (!parsed.success) return { ok: false, message: "Enter the email to send the reminder to." };
      address = parsed.data;
    }
    await optInRefill(order.id, address);
    revalidatePath(`/order/${orderNumber}`);
    return { ok: true, message: "Done. We'll email you once, a few days before it runs out." };
  } catch (error) {
    reportError("refill/opt-in", error);
    return { ok: false, message: "That didn't save. Try again in a moment." };
  }
}

/** Stop refill reminders, from the order page or the link in a reminder. */
export async function stopRefillReminders(orderNumber: string, token: string | null): Promise<RefillResult> {
  try {
    const order = await ownOrder(orderNumber, token);
    if (!order) return { ok: false, message: "That link doesn't match an order. Contact us and we'll stop them for you." };
    await stopRefill(order.id);
    revalidatePath(`/order/${orderNumber}`);
    return { ok: true, message: "Stopped. You won't get refill reminders from us." };
  } catch (error) {
    reportError("refill/stop", error);
    return { ok: false, message: "That didn't save. Try again in a moment." };
  }
}
