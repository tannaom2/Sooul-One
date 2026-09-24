"use client";

import { useCart } from "./cart-provider";

/** The menu's basket control: opens the drawer and shows the unit count. */
export function BasketButton() {
  const { count, openBasket } = useCart();
  return (
    <button
      type="button"
      onClick={openBasket}
      className="btn btn-outline ml-auto gap-2 px-3 py-1.5 text-small"
      aria-label={count > 0 ? `Basket, ${count} ${count === 1 ? "item" : "items"}` : "Basket, empty"}
      aria-haspopup="dialog"
    >
      Basket
      {count > 0 && (
        <span
          key={count}
          className="tabular grid min-w-5 place-items-center bg-ink px-1 text-micro font-bold text-paper motion-safe:animate-[badge-pop_200ms_ease-out]"
          style={{ borderRadius: 999 }}
          aria-hidden
        >
          {count}
        </span>
      )}
    </button>
  );
}
