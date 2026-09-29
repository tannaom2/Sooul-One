import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isSellable } from "@/lib/basket-rules";
import { reviewInputSchema } from "@/lib/validation/review";
import { limitPublic } from "@/server/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { clientIp } from "@/lib/rate-limit-rules";

/**
 * Review submission.
 *
 * `isApproved` is never set here — it defaults to false at the schema level
 * (see prisma/schema.prisma), so nothing a shopper submits reaches a product
 * page until an admin has read it. This matters more here than on most
 * review systems: a review on a HEALTH_SUPPLEMENT product that says "cured
 * my ___" is exactly the kind of therapeutic claim Section 8.5 and
 * src/lib/compliance/claims.ts exist to keep off this site, and unlike the
 * product copy an admin writes, review text comes from someone the claims
 * linter was never shown to. The moderation queue (src/app/admin/reviews)
 * runs the same linter against pending supplement reviews before an admin
 * approves one.
 */
export async function POST(request: Request) {
  const limited = await limitPublic("reviews");
  if (limited) return limited;
  // Human check, when Turnstile is on: reviews are a favourite target for spam scripts.
  const human = await verifyTurnstile(request.headers.get("x-turnstile-token"), { ip: clientIp(request.headers), expectedAction: "review", failOpen: true });
  if (!human.ok) return NextResponse.json({ message: "Tick the human check, then submit your review." }, { status: 403 });

  const parsed = reviewInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Check the highlighted fields.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const product = await db.product.findUnique({
    where: { id: parsed.data.productId },
    include: { brand: { select: { isActive: true } }, category: { select: { isActive: true } } },
  });
  if (!product || !isSellable(product)) {
    return NextResponse.json({ message: "That product isn't available." }, { status: 400 });
  }

  await db.review.create({
    data: {
      productId: parsed.data.productId,
      customerName: parsed.data.customerName,
      rating: parsed.data.rating,
      comment: parsed.data.comment,
      isApproved: false,
    },
  });

  return NextResponse.json({ ok: true });
}
