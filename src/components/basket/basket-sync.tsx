"use client";

import { useEffect } from "react";
import { useCart } from "./cart-provider";

/**
 * Re-reads the basket from the server once. Used on the order page: after an
 * online payment the basket is emptied by the payment webhook, which can't
 * reach this browser's badge cookie, so the page asks for the truth.
 */
export function BasketSync() {
  const { refresh } = useCart();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return null;
}
