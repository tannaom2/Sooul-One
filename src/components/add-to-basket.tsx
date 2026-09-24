"use client";

import { useState } from "react";
import { useCart } from "./basket/cart-provider";
import { QuantityStepper } from "./basket/quantity-stepper";

/**
 * Add-to-basket control.
 *
 * The button keeps the same verb through the whole flow — it says "Add to
 * basket", and the confirmation says "Added". Vocabulary consistency is how
 * people learn an interface, so the label never morphs into "Submit".
 *
 * Adding opens the basket drawer (src/components/basket) rather than leaving
 * the page; the badge and drawer update instantly and settle on the server's
 * answer.
 */
export function AddToBasket({ productId, productName }: { productId: string; productName: string }) {
  const { add, pending, error } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  async function onAdd() {
    setAdded(false);
    const ok = await add(productId, quantity);
    if (ok) {
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <span className="text-small font-semibold">Quantity</span>
        <QuantityStepper value={quantity} onChange={setQuantity} label={productName} />
      </div>

      <button onClick={onAdd} disabled={pending} className="btn btn-solid w-full">
        {added ? "Added ✓" : "Add to basket"}
      </button>

      {/* Always mounted so assistive tech is already watching this region
          before the content changes, per Web Interface Guidelines. */}
      <div aria-live="polite" role="status">
        {error && !added && <p className="text-small text-alert">{error}</p>}
        {added && <span className="sr-only">{`Added ${productName} to basket.`}</span>}
      </div>
    </div>
  );
}
