"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin, audit } from "@/lib/auth";

export async function moderateReview(reviewId: string, decision: "APPROVE" | "REJECT"): Promise<void> {
  const session = await requireAdmin();
  if (!session) throw new Error("Not authorized.");

  if (decision === "APPROVE") {
    await db.review.update({ where: { id: reviewId }, data: { isApproved: true } });
  } else {
    // A rejected review is deleted rather than kept in a "rejected" state —
    // there's no product page or report that shows rejected reviews, so
    // keeping the row around would only be a home for stale PII (a name and
    // free-text comment) with no further use.
    await db.review.delete({ where: { id: reviewId } });
  }

  await audit(session.adminUserId, `REVIEW_${decision}`, "Review", reviewId);
  revalidatePath("/admin/reviews");
}
