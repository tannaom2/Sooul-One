"use server";

import { revalidatePath } from "next/cache";
import { CATALOG_TAG, expireTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import { requirePermission, audit } from "@/lib/auth";

export async function moderateReview(reviewId: string, decision: "APPROVE" | "REJECT"): Promise<void> {
  const session = await requirePermission("reviews:moderate");
  if (!session) throw new Error("Not authorized.");

  const review = await db.review.findUnique({ where: { id: reviewId }, select: { productId: true, rating: true } });
  if (!review) return;

  if (decision === "APPROVE") {
    await db.review.update({ where: { id: reviewId }, data: { isApproved: true } });
  } else {
    // A rejected review is deleted rather than kept in a "rejected" state —
    // there's no product page or report that shows rejected reviews, so
    // keeping the row around would only be a home for stale PII (a name and
    // free-text comment) with no further use.
    await db.review.delete({ where: { id: reviewId } });
  }

  // Product and rating only. The reviewer's name and comment are left out on
  // purpose: a rejected review is deleted to avoid keeping a stranger's text,
  // and copying it into the permanent, append-only log would undo that.
  await audit(session, `REVIEW_${decision}`, "Review", reviewId, review);
  revalidatePath("/admin/reviews");
  // Approved reviews appear on the product page.
  expireTag(CATALOG_TAG);
}
