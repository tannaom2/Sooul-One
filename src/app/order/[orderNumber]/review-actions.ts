"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { canReviewFrom } from "@/lib/follow-ups";
import { reportError } from "@/lib/observability";
import { reviewInputSchema } from "@/lib/validation/review";
import { ownOrder } from "@/server/order-owner";

export interface ReviewResult {
  ok: boolean;
  message: string;
  fieldErrors?: { customerName?: string; rating?: string; comment?: string };
}

/**
 * A review written from the shopper's own order page (benchmark gap C8). It
 * carries the order, which shows it as from a verified buyer. Like every
 * review it waits for approval in the console, where supplement reviews go
 * through the claims check (src/app/api/reviews/route.ts explains why). One
 * per product per order, enforced by the database.
 */
export async function submitOrderReview(
  orderNumber: string,
  token: string | null,
  input: { productId: string; customerName: string; rating: number; comment: string },
): Promise<ReviewResult> {
  try {
    const owned = await ownOrder(orderNumber, token);
    if (!owned) return { ok: false, message: "That order couldn't be found." };
    const order = await db.order.findUnique({ where: { id: owned.id }, select: { status: true, items: { select: { productId: true } } } });
    if (!order || !canReviewFrom(order.status)) return { ok: false, message: "You can review once your order has been delivered." };
    if (!order.items.some((i) => i.productId === input.productId)) return { ok: false, message: "That product isn't in this order." };

    const parsed = reviewInputSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: ReviewResult["fieldErrors"] = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "customerName" || field === "rating" || field === "comment") fieldErrors[field] ??= issue.message;
      }
      return { ok: false, message: "Check the highlighted fields.", fieldErrors };
    }

    await db.review.create({
      data: { orderId: owned.id, productId: parsed.data.productId, customerName: parsed.data.customerName, rating: parsed.data.rating, comment: parsed.data.comment, isApproved: false },
    });
    revalidatePath(`/order/${orderNumber}`);
    return { ok: true, message: "Thank you. Your review will appear once we've had a look." };
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") return { ok: false, message: "You've already reviewed this product from this order." };
    reportError("review/order", error);
    return { ok: false, message: "That didn't save. Try again in a moment." };
  }
}
