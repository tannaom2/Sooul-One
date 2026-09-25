"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "./basket/cart-provider";

/** On the full /cart page: drop what can't ship and trim what partly can. */
export function RemoveUnavailableButton() {
  const { removeUnavailable } = useCart();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await removeUnavailable();
          // This page is server-rendered from the same basket; re-render it.
          router.refresh();
        })
      }
      className="btn btn-solid w-full"
    >
      {pending ? "Updating…" : "Remove unavailable items"}
    </button>
  );
}
