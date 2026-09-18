"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function CartQuantity({ itemId, quantity }: { itemId: string; quantity: number }) {
  const [value, setValue] = useState(quantity);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function commit(next: number) {
    setValue(next);
    await fetch("/api/cart", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, quantity: next }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <span className="flex items-center gap-2">
      <label htmlFor={`q-${itemId}`} className="text-micro font-semibold text-ink-soft">
        Qty
      </label>
      <input
        id={`q-${itemId}`}
        type="number"
        min={0}
        max={20}
        value={value}
        onChange={(e) => commit(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
        className="field tabular w-16 px-2 py-1 text-small"
      />
      <button onClick={() => commit(0)} className="text-micro underline hover:text-alert">
        Remove
      </button>
    </span>
  );
}
