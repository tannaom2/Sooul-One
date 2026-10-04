"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Live, server-side re-quote as the pincode, state or coupon changes.
 * Debounced and abortable, because a shopper types faster than the server
 * answers; `empty` is set when there's no basket to check out at all. The
 * first quote goes at once: nothing is being typed yet, and the order summary
 * waits on it. `refresh()` re-quotes at once and returns the new quote: after
 * a guest proves their number, a friend's offer may now apply.
 */
export function useQuote(pincode: string, state: string, couponCode: string) {
  const [quote, setQuote] = useState<any>(null);
  const [couponRejected, setCouponRejected] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  // Referral money: whose offer or how much credit, and whether a guest has a friend's code waiting.
  const [creditNote, setCreditNote] = useState<string | null>(null);
  const [referralWaiting, setReferralWaiting] = useState(false);
  // Whether cash on delivery is offered for this pincode, number and total.
  const [cod, setCod] = useState<{ allowed: boolean; message?: string }>({ allowed: true });
  const firstQuote = useRef(true);

  /** One quote from the server, applied to the state above; the quote, or null if there isn't one. */
  const load = useCallback(
    async (signal?: AbortSignal): Promise<any> => {
      const response = await fetch("/api/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pincode: /^\d{6}$/.test(pincode) ? pincode : undefined,
          state: state || undefined,
          couponCode: couponCode || undefined,
        }),
        signal,
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setQuote(body.quote);
        setCouponRejected(body.couponRejected ? (body.couponMessage ?? "That code isn't valid for this order.") : null);
        setEmpty(false);
        setCreditNote(body.creditNote ?? null);
        setReferralWaiting(Boolean(body.referralWaiting));
        setCod(body.cod ?? { allowed: true });
        return body.quote;
      }
      if (/basket is empty/i.test(body.message ?? "")) setEmpty(true);
      return null;
    },
    [pincode, state, couponCode],
  );

  useEffect(() => {
    const controller = new AbortController();
    const delay = firstQuote.current ? 0 : 350;
    firstQuote.current = false;
    const timer = setTimeout(() => {
      load(controller.signal).catch(() => {
        /* an aborted re-quote is normal while typing */
      });
    }, delay);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [load]);

  const refresh = useCallback(() => load().catch(() => null), [load]);

  return { quote, couponRejected, empty, creditNote, referralWaiting, cod, refresh };
}
