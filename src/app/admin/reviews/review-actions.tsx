"use client";

import { useTransition } from "react";
import { moderateReview } from "./actions";

/** Take a published review off the product page, back into the moderation queue. */
export function UnpublishReview({ reviewId }: { reviewId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => startTransition(() => moderateReview(reviewId, "UNPUBLISH"))}
      disabled={pending}
      className="btn btn-outline px-3 py-1.5 text-small"
    >
      {pending ? "Taking down…" : "Take down"}
    </button>
  );
}

export function ReviewActions({ reviewId }: { reviewId: string }) {
  const [pending, startTransition] = useTransition();

  function act(decision: "APPROVE" | "REJECT" | "UNPUBLISH") {
    startTransition(() => moderateReview(reviewId, decision));
  }

  return (
    <div className="flex gap-2">
      <button onClick={() => act("APPROVE")} disabled={pending} className="btn btn-solid px-3 py-1.5 text-small">
        Approve
      </button>
      <button onClick={() => act("REJECT")} disabled={pending} className="btn btn-outline px-3 py-1.5 text-small">
        Reject
      </button>
    </div>
  );
}
