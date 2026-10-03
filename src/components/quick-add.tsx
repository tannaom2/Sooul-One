"use client";

import { useState } from "react";
import { useCart } from "./basket/cart-provider";

/**
 * One tap from a product card to the basket (benchmark gap C6): one unit (or
 * one pack), with the drawer opening on it, as on the product page. Anything
 * more (packs, quantities, combos) stays on the product page.
 */
export function QuickAdd({ productId, productName }: { productId: string; productName: string }) {
  const { add, pending } = useCart();
  const [added, setAdded] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-outline w-full"
      disabled={pending}
      aria-label={`Add ${productName} to basket`}
      onClick={async () => {
        setAdded(false);
        if (await add(productId, 1, { via: "card" })) {
          setAdded(true);
          setTimeout(() => setAdded(false), 2000);
        }
      }}
    >
      {added ? "Added ✓" : "Add to basket"}
    </button>
  );
}
