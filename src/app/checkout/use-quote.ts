"use client";

import { useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Live, server-side re-quote as the pincode, state or coupon changes.
 * Debounced and abortable, because a shopper types faster than the server
 * answers; `empty` is set when there's no basket to check out at all. The
 * first quote goes at once: nothing is being typed yet, and the order summary
 * waits on it.
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

  useEffect(() => {
    const controller = new AbortController();
    const delay = firstQuote.current ? 0 : 350;
    firstQuote.current = false;
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
          setCouponRejected(body.couponRejected ? (body.couponMessage ?? "That code isn't valid for this order.") : null);
          setEmpty(false);
          setCreditNote(body.creditNote ?? null);
          setReferralWaiting(Boolean(body.referralWaiting));
          setCod(body.cod ?? { allowed: true });
        } else if (/basket is empty/i.test(body.message ?? "")) {
          setEmpty(true);
        }
      } catch {
        /* an aborted re-quote is normal while typing */
      }
    }, delay);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [pincode, state, couponCode]);

  return { quote, couponRejected, empty, creditNote, referralWaiting, cod };
}
