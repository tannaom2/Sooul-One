import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { lintSupplementCopy } from "@/lib/compliance/claims";
import { ReviewActions, UnpublishReview } from "./review-actions";
import { reportError } from "@/lib/observability";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function ReviewsPage() {
  const session = await requirePermission("reviews:moderate");
  if (!session) return <NoAccess />;

  let pending: any[] = [];
  let published: any[] = [];
  try {
    [pending, published] = await Promise.all([
      db.review.findMany({
        where: { isApproved: false },
        include: { product: { select: { name: true, regulatoryType: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.review.findMany({
        where: { isApproved: true },
        include: { product: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
  } catch (error) {
    reportError("admin/reviews", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and that migrations have run." />;
  }

  return (
    <div className="grid gap-10">
    <div>
      <h1 className="mb-2 text-h2 font-extrabold">Review moderation</h1>
      <p className="mb-6 max-w-2xl text-small text-ink-soft">
        Nothing here has been shown to a shopper yet. A review only appears on its product page once
        approved.
      </p>

      {pending.length === 0 && (
        <Empty title="Nothing to moderate" detail="New reviews land here the moment a shopper submits one." />
      )}
      <div className="grid gap-4">
        {pending.map((r) => {
          // Only meaningful for supplements — Section 8.5's therapeutic-claim
          // rules are a HEALTH_SUPPLEMENT concern, and running the linter
          // against ordinary food-review language would just be noise.
          const lint =
            r.product.regulatoryType === "HEALTH_SUPPLEMENT" ? lintSupplementCopy(r.comment) : null;

          return (
            <div
              key={r.id}
              className="panel"
              style={{ borderColor: lint?.blockingCount ? "var(--color-alert)" : undefined }}
            >
              <div className="panel-head flex flex-wrap items-center justify-between gap-2">
                <span>{r.product.name}</span>
                <span className="text-micro font-normal text-ink-faint">{formatDate(r.createdAt)}</span>
              </div>

              <div className="p-3.5">
                <div className="flex items-center gap-2">
                  <span aria-hidden style={{ color: "var(--color-caution)" }}>
                    {"★".repeat(r.rating)}
                    {"☆".repeat(5 - r.rating)}
                  </span>
                  <span className="text-small font-semibold">{r.customerName}</span>
                </div>
                <p className="mt-2 text-small">{r.comment}</p>

                {lint && lint.findings.length > 0 && (
                  <div className="mt-3 border-l-4 border-alert bg-shelf px-3 py-2">
                    <p className="text-micro font-semibold">
                      Claims linter flagged this review
                      {lint.blockingCount > 0 ? " — likely a therapeutic claim" : " — worth a second look"}
                    </p>
                    <ul className="mt-1 grid gap-1 text-micro text-ink-soft">
                      {lint.findings.map((f, i) => (
                        <li key={i}>
                          &ldquo;{f.matchedText}&rdquo; — {f.explanation}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3">
                  <ReviewActions reviewId={r.id} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>

    {published.length > 0 && (
      <section aria-labelledby="published-heading">
        <h2 id="published-heading" className="mb-2 text-h3 font-bold">
          Published
        </h2>
        <p className="mb-4 max-w-2xl text-small text-ink-soft">
          Live on product pages, newest first. Taking one down removes it from the page at once and puts it back in the
          queue above.
        </p>
        <ul className="panel">
          {published.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-[--color-rule] px-3.5 py-3 text-small last:border-b-0">
              <div className="min-w-0 max-w-2xl">
                <p>
                  <span className="font-semibold">{r.product.name}</span>
                  <span className="ml-2 text-ink-faint">
                    {"★".repeat(r.rating)} · {r.customerName} · {formatDate(r.createdAt)}
                  </span>
                </p>
                <p className="mt-1 text-ink-soft">{r.comment}</p>
              </div>
              <UnpublishReview reviewId={r.id} />
            </li>
          ))}
        </ul>
      </section>
    )}
    </div>
  );
}
