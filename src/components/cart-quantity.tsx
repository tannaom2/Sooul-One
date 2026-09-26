"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "./basket/cart-provider";
import { QuantityStepper } from "./basket/quantity-stepper";
import { MAX_LINE_QUANTITY } from "@/lib/basket-types";

/**
 * Quantity control on the full /cart page; shares the drawer's basket state.
 * `inKits` units are shown in a kit above, so this controls only the rest.
 */
export function CartQuantity({ itemId, quantity, name, inKits = 0 }: { itemId: string; quantity: number; name: string; inKits?: number }) {
  const { setQuantity } = useCart();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function change(next: number) {
    startTransition(async () => {
      await setQuantity(itemId, inKits + next);
      // This page is server-rendered from the same basket; re-render it.
      router.refresh();
    });
  }

  return (
    <span className="flex items-center gap-3">
      <QuantityStepper value={quantity - inKits} min={0} max={MAX_LINE_QUANTITY - inKits} label={name} onChange={change} disabled={pending} />
      <button type="button" onClick={() => change(0)} disabled={pending} className="text-micro underline hover:text-alert">
        Remove
      </button>
    </span>
  );
}
