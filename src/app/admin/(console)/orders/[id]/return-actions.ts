"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { CATALOG_TAG, refreshTag } from "@/lib/cache-tags";
import { recordOrderEvent } from "@/lib/order-events";
import { SLOWEST_SERVED_ZONE, estimateDeliveryDate } from "@/lib/checkout/delivery";
import { decisionSummary, isFinal, isReturned, restockProblem, type ReturnOutcome } from "@/lib/returns";

export interface ReturnResult {
  ok: boolean;
  message: string;
  lineErrors?: Record<string, string>;
}

const input = z.array(
  z.object({
    orderItemId: z.string().min(1).max(40),
    outcome: z.enum(["RESTOCKED", "QUARANTINED", "WRITTEN_OFF"]),
    note: z.string().trim().max(300).optional(),
  }),
).min(1).max(50);

/**
 * Record what was found in a parcel that came back (src/lib/returns.ts).
 * "Back to stock" adds the units to their batch, in the same transaction as
 * the decision, so a double click can't add them twice.
 */
export async function checkReturnedParcel(orderId: string, decisions: { orderItemId: string; outcome: ReturnOutcome; note?: string }[]): Promise<ReturnResult> {
  const session = await requirePermission("orders:write");
  if (!session) return { ok: false, message: "Your role can't check returned parcels." };
  const parsed = input.safeParse(decisions);
  if (!parsed.success) return { ok: false, message: "Choose what happens to each line." };

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      status: true,
      items: { select: { id: true, quantity: true, productNameSnapshot: true, returnCheck: { select: { outcome: true } }, batch: { select: { id: true, recalledAt: true, expiresOn: true } }, product: { select: { shelfLifeDays: true } } } },
    },
  });
  if (!order) return { ok: false, message: "That order no longer exists." };
  if (!isReturned(order.status)) return { ok: false, message: "Only a parcel that came back (RTO or returned) is checked here." };

  const arrivesBy = estimateDeliveryDate(new Date(), SLOWEST_SERVED_ZONE);
  const lineErrors: Record<string, string> = {};
  const changes = parsed.data.filter((d) => {
    const item = order.items.find((i) => i.id === d.orderItemId);
    if (!item) {
      lineErrors[d.orderItemId] = "This line isn't on the order.";
      return false;
    }
    // Final decisions stand; an unchanged set-aside isn't a change.
    if (isFinal(item.returnCheck?.outcome)) return false;
    if (item.returnCheck?.outcome === d.outcome) return false;
    if (d.outcome === "RESTOCKED") {
      const problem = restockProblem(item.batch, item.product.shelfLifeDays, arrivesBy);
      if (problem) lineErrors[d.orderItemId] = problem;
    }
    return true;
  });
  if (Object.keys(lineErrors).length) return { ok: false, message: "Some lines can't be decided that way.", lineErrors };
  if (changes.length === 0) return { ok: true, message: "Nothing new to record." };

  try {
    await db.$transaction(async (tx) => {
      for (const d of changes) {
        const item = order.items.find((i) => i.id === d.orderItemId)!;
        // Only one save can take a line from undecided or set aside to its new
        // state: a new line's unique id, or a set-aside line's conditional
        // update, fails for the second of two racing saves, before any stock moves twice.
        if (item.returnCheck) {
          const { count } = await tx.returnCheck.updateMany({
            where: { orderItemId: d.orderItemId, outcome: "QUARANTINED" },
            data: { outcome: d.outcome, note: d.note || null, decidedBy: session.email, decidedAt: new Date() },
          });
          if (count !== 1) throw new Error("decided meanwhile");
        } else {
          await tx.returnCheck.create({ data: { orderItemId: d.orderItemId, outcome: d.outcome, quantity: item.quantity, note: d.note || null, decidedBy: session.email } });
        }
        if (d.outcome === "RESTOCKED") {
          await tx.productBatch.update({ where: { id: item.batch!.id }, data: { quantityRemaining: { increment: item.quantity } } });
        }
      }
    });
  } catch {
    return { ok: false, message: "Someone else saved this check at the same moment. Reload to see what was recorded." };
  }

  const summary = decisionSummary(changes.map((d) => ({ outcome: d.outcome, quantity: order.items.find((i) => i.id === d.orderItemId)!.quantity })));
  await recordOrderEvent(orderId, "NOTE", { type: "ADMIN", email: session.email }, { note: `Returned parcel checked: ${summary}.` });
  await audit(session, "CHECK_RETURNED_PARCEL", "Order", orderId, { order: order.orderNumber, decisions: changes.map((d) => ({ line: d.orderItemId, outcome: d.outcome })) });
  if (changes.some((d) => d.outcome === "RESTOCKED")) refreshTag(CATALOG_TAG);
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin");
  return { ok: true, message: `Recorded: ${summary}.` };
}
