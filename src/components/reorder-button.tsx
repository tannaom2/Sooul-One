"use client";

import { useState } from "react";
import { useCart } from "@/components/basket/cart-provider";

/**
 * "Order again" (src/lib/reorder.ts): the order's products go back in the
 * basket and the drawer opens on them, with a note for anything that's
 * unavailable now. The token is the order link's own (?t=); a signed-in
 * shopper's own orders need none.
 */
export function ReorderButton({ orderNumber, token, className = "btn btn-outline" }: { orderNumber: string; token: string | null; className?: string }) {
  const { reorder } = useCart();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await reorder(orderNumber, token);
        setBusy(false);
      }}
    >
      {busy ? "Adding…" : "Order again"}
    </button>
  );
}
