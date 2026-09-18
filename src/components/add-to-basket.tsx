"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Add-to-basket control.
 *
 * The button keeps the same verb through the whole flow — it says "Add to
 * basket", and the confirmation says "Added". Vocabulary consistency is how
 * people learn an interface, so the label never morphs into "Submit".
 */
export function AddToBasket({ productId, productName }: { productId: string; productName: string }) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function add() {
    setError(null);
    try {
      const response = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? "That didn't save. Try again.");
        return;
      }
      setAdded(true);
      startTransition(() => router.refresh());
    } catch {
      setError("No connection. Check your network and try again.");
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <label htmlFor="qty" className="text-small font-semibold">
          Quantity
        </label>
        <input
          id="qty"
          type="number"
          min={1}
          max={20}
          value={quantity}
          onChange={(e) => {
            setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)));
            setAdded(false);
          }}
          className="field tabular w-20"
        />
      </div>

      <button onClick={add} disabled={pending} className="btn btn-solid w-full">
        {added ? `Added ${productName}` : "Add to basket"}
      </button>

      {added && (
        <a href="/cart" className="text-center text-small font-semibold underline">
          Go to basket
        </a>
      )}

      {error && <p className="text-small text-alert">{error}</p>}
    </div>
  );
}
