"use client";

import { useState } from "react";

export function ReviewForm({ productId }: { productId: string }) {
  const [name, setName] = useState("");
  // No rating until the shopper picks one: a preset five stars gets submitted
  // untouched and inflates the average.
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; rating?: string; comment?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    // Stays enabled at all times (per Web Interface Guidelines) — validation
    // happens on click, pointed at the specific field that's empty.
    const errors: { name?: string; rating?: string; comment?: string } = {};
    if (!name.trim()) errors.name = "Enter your name.";
    if (rating === 0) errors.rating = "Choose a rating from 1 to 5 stars.";
    if (!comment.trim()) errors.comment = "Say something about the product.";
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      document.getElementById(errors.name ? "reviewName" : errors.rating ? "reviewRating1" : "reviewComment")?.focus();
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, customerName: name, rating, comment }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? "That didn't save. Try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div aria-live="polite" role="status">
      {submitted ? (
        <p className="panel p-4 text-small text-veg">
          Thanks — your review is in. It&apos;ll appear here once we&apos;ve had a look.
        </p>
      ) : (
        <div className="grid max-w-xl gap-4">
          <div>
            <label className="label" htmlFor="reviewName">
              Your name
            </label>
            <input
              id="reviewName"
              className="field"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {fieldErrors.name && <p className="mt-1 text-micro text-alert">{fieldErrors.name}</p>}
          </div>

          <fieldset>
            <legend className="label">Rating</legend>
            {/* Native radios: one choice out of five, arrow keys move between them,
                and screen readers announce "3 stars, 3 of 5". */}
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="cursor-pointer text-h3 leading-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2">
                  <input
                    type="radio"
                    name="reviewRating"
                    id={`reviewRating${n}`}
                    value={n}
                    checked={rating === n}
                    onChange={() => setRating(n)}
                    className="sr-only"
                  />
                  <span aria-hidden="true" style={{ color: n <= rating ? "var(--color-caution)" : "var(--color-rule)" }}>
                    ★
                  </span>
                  <span className="sr-only">{`${n} star${n === 1 ? "" : "s"}`}</span>
                </label>
              ))}
              {rating > 0 && <span className="ml-2 text-small text-ink-soft">{rating} of 5</span>}
            </div>
            {fieldErrors.rating && <p className="mt-1 text-micro text-alert">{fieldErrors.rating}</p>}
          </fieldset>

          <div>
            <label className="label" htmlFor="reviewComment">
              Your review
            </label>
            <textarea
              id="reviewComment"
              className="field"
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            {fieldErrors.comment && <p className="mt-1 text-micro text-alert">{fieldErrors.comment}</p>}
          </div>

          {error && <p className="text-small text-alert">{error}</p>}

          <button onClick={submit} disabled={busy} className="btn btn-solid w-fit">
            {busy ? "Sending…" : "Submit review"}
          </button>
        </div>
      )}
    </div>
  );
}
