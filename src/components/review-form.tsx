"use client";

import { useState } from "react";

export function ReviewForm({ productId }: { productId: string }) {
  const [name, setName] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; comment?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    // Stays enabled at all times (per Web Interface Guidelines) — validation
    // happens on click, pointed at the specific field that's empty.
    const errors: { name?: string; comment?: string } = {};
    if (!name.trim()) errors.name = "Enter your name.";
    if (!comment.trim()) errors.comment = "Say something about the product.";
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      document.getElementById(errors.name ? "reviewName" : "reviewComment")?.focus();
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
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  aria-pressed={n <= rating}
                  className="text-h3 leading-none"
                  style={{ color: n <= rating ? "var(--color-caution)" : "var(--color-rule)" }}
                >
                  ★
                </button>
              ))}
            </div>
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
