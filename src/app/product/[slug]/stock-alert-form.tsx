"use client";

import { useState, useTransition } from "react";
import { askBackInStock } from "./stock-alert-actions";
import type { AlertRequest } from "@/server/stock-alerts";

/** Under "out of stock": one email when it's back (benchmark gap R9). */
export function StockAlertForm({ productId, notice }: { productId: string; notice: string }) {
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AlertRequest | null>(null);
  if (result?.ok) {
    return (
      <p role="status" className="mt-3 text-small text-veg">
        {result.message}
      </p>
    );
  }
  return (
    <form
      className="mt-3 grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await askBackInStock(productId, email)));
      }}
    >
      <label className="text-small font-semibold" htmlFor="stock-alert-email">
        Email me when it&apos;s back
      </label>
      <div className="flex gap-2">
        <input
          id="stock-alert-email"
          type="email"
          required
          autoComplete="email"
          spellCheck={false}
          className="field min-w-0 flex-1"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn btn-solid shrink-0" disabled={pending}>
          {pending ? "Saving…" : "Notify me"}
        </button>
      </div>
      <p className="text-micro text-ink-faint">{notice}</p>
      {result && (
        <p role="status" className="text-small text-alert">
          {result.message}
        </p>
      )}
    </form>
  );
}
