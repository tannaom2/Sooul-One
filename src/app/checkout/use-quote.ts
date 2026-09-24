"use client";

import { useEffect, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Live, server-side re-quote as the pincode, state or coupon changes.
 * Debounced and abortable, because a shopper types faster than the server
 * answers; `empty` is set when there's no basket to check out at all.
 */
export function useQuote(pincode: string, state: string, couponCode: string) {
  const [quote, setQuote] = useState<any>(null);
  const [couponRejected, setCouponRejected] = useState(false);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/checkout/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pincode: /^\d{6}$/.test(pincode) ? pincode : undefined,
            state: state || undefined,
            couponCode: couponCode || undefined,
          }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) {
          setQuote(body.quote);
          setCouponRejected(Boolean(body.couponRejected));
          setEmpty(false);
        } else if (/basket is empty/i.test(body.message ?? "")) {
          setEmpty(true);
        }
      } catch {
        /* an aborted re-quote is normal while typing */
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [pincode, state, couponCode]);

  return { quote, couponRejected, empty };
}
