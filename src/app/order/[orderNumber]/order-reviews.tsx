"use client";

import { useState, useTransition } from "react";
import { submitOrderReview, type ReviewResult } from "./review-actions";

type Item = { productId: string; name: string; review: { rating: number; published: boolean } | null };

/**
 * "Review what you bought" on a delivered order's page (benchmark gap C8),
 * where the day-14 review request lands (#review). Reviews written here show
 * as from a verified buyer once approved.
 */
export function OrderReviews({ orderNumber, token, items, suggestedName }: { orderNumber: string; token: string | null; items: Item[]; suggestedName: string }) {
  const [done, setDone] = useState<Record<string, number>>({});
  return (
    <section id="review" className="panel mt-8 scroll-mt-24 p-4" aria-labelledby="review-heading">
      <h2 id="review-heading" className="font-display text-lead font-bold">
        Review what you bought
      </h2>
      <p className="mt-1 text-small text-ink-soft">
        Honest reviews help other shoppers, good or bad. Yours shows as from a verified buyer. We read each one first, and we don&apos;t
        publish health claims.
      </p>
      <ul className="mt-4 grid gap-4">
        {items.map((item) => {
          const rated = item.review?.rating ?? done[item.productId];
          return (
            <li key={item.productId} className="border-t border-rule pt-4">
              <p className="text-small font-semibold">{item.name}</p>
              {rated ? (
                <p className="mt-1 text-small text-ink-soft">
                  <span aria-hidden style={{ color: "var(--color-caution)" }}>
                    {"★".repeat(rated)}
                    {"☆".repeat(5 - rated)}
                  </span>{" "}
                  {item.review?.published ? "Your review is live." : "Thanks. Your review will appear once we've had a look."}
                </p>
              ) : (
                <ReviewLine
                  orderNumber={orderNumber}
                  token={token}
                  productId={item.productId}
                  suggestedName={suggestedName}
                  onDone={(rating) => setDone((d) => ({ ...d, [item.productId]: rating }))}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ReviewLine({
  orderNumber,
  token,
  productId,
  suggestedName,
  onDone,
}: {
  orderNumber: string;
  token: string | null;
  productId: string;
  suggestedName: string;
  onDone: (rating: number) => void;
}) {
  const [pending, start] = useTransition();
  // No rating until the shopper picks one: a preset five stars inflates the average.
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [name, setName] = useState(suggestedName);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const ids = { name: `rn-${productId}`, comment: `rc-${productId}` };
  const fe = result?.fieldErrors ?? {};

  return (
    <form
      className="mt-2 grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (rating === 0) {
          setResult({ ok: false, message: "Choose a rating from 1 to 5 stars.", fieldErrors: { rating: "Choose a rating from 1 to 5 stars." } });
          return;
        }
        start(async () => {
          const r = await submitOrderReview(orderNumber, token, { productId, customerName: name, rating, comment });
          setResult(r);
          if (r.ok) onDone(rating);
        });
      }}
    >
      <fieldset>
        <legend className="sr-only">Rating</legend>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer text-h3 leading-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2">
              <input type="radio" name={`rating-${productId}`} value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />
              <span aria-hidden="true" style={{ color: n <= rating ? "var(--color-caution)" : "var(--color-rule)" }}>
                ★
              </span>
              <span className="sr-only">{`${n} star${n === 1 ? "" : "s"}`}</span>
            </label>
          ))}
          {rating > 0 && <span className="ml-2 text-small text-ink-soft">{rating} of 5</span>}
        </div>
        {fe.rating && <p className="mt-1 text-micro text-alert">{fe.rating}</p>}
      </fieldset>
      {rating > 0 && (
        <>
          <div>
            <label className="label" htmlFor={ids.comment}>
              Your review
            </label>
            <textarea id={ids.comment} className="field" rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
            {fe.comment && <p className="mt-1 text-micro text-alert">{fe.comment}</p>}
          </div>
          <div>
            <label className="label" htmlFor={ids.name}>
              Name to show
            </label>
            <input id={ids.name} className="field" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            {fe.customerName && <p className="mt-1 text-micro text-alert">{fe.customerName}</p>}
          </div>
          <div>
            <button className="btn btn-solid" disabled={pending}>
              {pending ? "Sending…" : "Submit review"}
            </button>
          </div>
        </>
      )}
      {result && !result.ok && !result.fieldErrors && (
        <p role="status" className="text-small text-alert">
          {result.message}
        </p>
      )}
    </form>
  );
}
