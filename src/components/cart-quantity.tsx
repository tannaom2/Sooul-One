"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "./basket/cart-provider";
import { QuantityStepper } from "./basket/quantity-stepper";

/** Quantity control on the full /cart page; shares the drawer's basket state. */
export function CartQuantity({ itemId, quantity, name }: { itemId: string; quantity: number; name: string }) {
  const { setQuantity } = useCart();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function change(next: number) {
    startTransition(async () => {
      await setQuantity(itemId, next);
      // This page is server-rendered from the same basket; re-render it.
      router.refresh();
    });
  }

  return (
    <span className="flex items-center gap-3">
      <QuantityStepper value={quantity} min={0} label={name} onChange={change} disabled={pending} />
      <button type="button" onClick={() => change(0)} disabled={pending} className="text-micro underline hover:text-alert">
        Remove
      </button>
    </span>
  );
}
