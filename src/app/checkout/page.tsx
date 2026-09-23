"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatINR } from "@/lib/money";
import { checkoutInputSchema } from "@/lib/validation/checkout";

/**
 * Checkout.
 *
 * Guest checkout is first class — no account wall. The totals shown here are
 * re-quoted server-side as the pincode and coupon change, and re-quoted again
 * on submit, because a basket can become non-compliant while someone is typing
 * their address.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
  }
}

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  couponCode: "",
};

// The same schema create-order/route.ts validates against, not a hand-copied
// regex set — a rule change there now can't silently fall out of sync with
// what this page checks before the round trip.
const REQUIRED_FIELDS_SCHEMA = checkoutInputSchema.pick({
  name: true,
  email: true,
  phone: true,
  line1: true,
  city: true,
  state: true,
  postalCode: true,
});

function validate(form: typeof EMPTY): Record<string, string> {
  const result = REQUIRED_FIELDS_SCHEMA.safeParse(form);
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0]);
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export default function Checkout() {
  const [form, setForm] = useState(EMPTY);
  const [quote, setQuote] = useState<any>(null);
  const [blocked, setBlocked] = useState<{ name: string; reason?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<"RAZORPAY" | "COD">("RAZORPAY");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // Once per mount, not on every re-quote below — this page is where
  // CHECKOUT_STARTED lives in the funnel, and it needs to fire exactly once
  // per visit to this page for the drop-off rate to mean anything.
  useEffect(() => {
    fetch("/api/analytics/checkout-started", { method: "POST" }).catch(() => {});
  }, []);

  // Re-quote whenever something that affects price or compliance changes.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/checkout/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pincode: /^\d{6}$/.test(form.postalCode) ? form.postalCode : undefined,
            state: form.state || undefined,
            couponCode: form.couponCode || undefined,
          }),
          signal: controller.signal,
        });
        if (response.ok) setQuote((await response.json()).quote);
      } catch {
        /* an aborted re-quote is normal while typing */
      }
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [form.postalCode, form.state, form.couponCode]);

  function set(field: keyof typeof EMPTY, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit() {
    // Stays enabled at all times (per Web Interface Guidelines) — validation
    // happens on click, pointed at the specific field that's wrong, rather
    // than leaving the shopper guessing why the button won't respond.
    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      document.getElementById(Object.keys(errors)[0])?.focus();
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError(null);
    setBlocked([]);

    try {
      const response = await fetch("/api/checkout/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, paymentMethod: method, marketingConsent }),
      });
      const body = await response.json();

      if (response.status === 409) {
        setBlocked(body.blocked ?? []);
        setError(body.message);
        return;
      }
      if (!response.ok) {
        if (Array.isArray(body.issues)) {
          const serverErrors: Record<string, string> = {};
          for (const issue of body.issues) {
            const key = String(issue.path?.[0] ?? "");
            if (key && !serverErrors[key]) serverErrors[key] = issue.message;
          }
          setFieldErrors(serverErrors);
          const firstKey = Object.keys(serverErrors)[0];
          if (firstKey) document.getElementById(firstKey)?.focus();
        }
        setError(body.message ?? "That didn't go through. Check your details and try again.");
        return;
      }

      if (body.method === "COD") {
        router.push(`/order/${body.orderNumber}`);
        return;
      }

      // Hosted Checkout: card data never touches this application, which is
      // what keeps PCI scope at SAQ-A.
      if (!window.Razorpay) {
        setError("Payment window didn't load. Refresh and try again.");
        return;
      }

      new window.Razorpay({
        key: body.keyId,
        amount: body.amount,
        currency: "INR",
        name: "SooulOne",
        order_id: body.razorpayOrderId,
        prefill: { name: form.name, email: form.email, contact: form.phone },
        handler: () => router.push(`/order/${body.orderNumber}`),
        modal: { ondismiss: () => setBusy(false) },
      }).open();
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />

      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 lg:grid-cols-[1fr_340px]">
        <div>
          <h1 className="text-h1 font-extrabold">Checkout</h1>
          <p className="mt-2 text-ink-soft">No account needed.</p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="name">Full name</label>
              <input
                id="name"
                className="field"
                autoComplete="name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
              {fieldErrors.name && <p className="mt-1 text-micro text-alert">{fieldErrors.name}</p>}
            </div>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="field"
                autoComplete="email"
                spellCheck={false}
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
              {fieldErrors.email && <p className="mt-1 text-micro text-alert">{fieldErrors.email}</p>}
            </div>
            <div>
              <label className="label" htmlFor="phone">Mobile number</label>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                className="field tabular"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
              {fieldErrors.phone && <p className="mt-1 text-micro text-alert">{fieldErrors.phone}</p>}
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="line1">Address</label>
              <input
                id="line1"
                className="field"
                autoComplete="address-line1"
                value={form.line1}
                onChange={(e) => set("line1", e.target.value)}
              />
              {fieldErrors.line1 && <p className="mt-1 text-micro text-alert">{fieldErrors.line1}</p>}
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="line2">Apartment, landmark (optional)</label>
              <input
                id="line2"
                className="field"
                autoComplete="address-line2"
                value={form.line2}
                onChange={(e) => set("line2", e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="city">City</label>
              <input
                id="city"
                className="field"
                autoComplete="address-level2"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              />
              {fieldErrors.city && <p className="mt-1 text-micro text-alert">{fieldErrors.city}</p>}
            </div>
            <div>
              <label className="label" htmlFor="state">State</label>
              <input
                id="state"
                className="field"
                autoComplete="address-level1"
                value={form.state}
                onChange={(e) => set("state", e.target.value)}
              />
              {fieldErrors.state && <p className="mt-1 text-micro text-alert">{fieldErrors.state}</p>}
            </div>
            <div>
              <label className="label" htmlFor="postalCode">Pincode</label>
              <input
                id="postalCode"
                inputMode="numeric"
                className="field tabular"
                autoComplete="postal-code"
                value={form.postalCode}
                onChange={(e) => set("postalCode", e.target.value)}
              />
              {fieldErrors.postalCode && <p className="mt-1 text-micro text-alert">{fieldErrors.postalCode}</p>}
            </div>
            <div>
              <label className="label" htmlFor="couponCode">Discount code (optional)</label>
              <input
                id="couponCode"
                className="field"
                autoComplete="off"
                spellCheck={false}
                value={form.couponCode}
                onChange={(e) => set("couponCode", e.target.value.toUpperCase())}
              />
            </div>
          </div>

          <fieldset className="mt-8">
            <legend className="label">How would you like to pay?</legend>
            <div className="grid gap-2">
              {([["RAZORPAY", "Card, UPI, net banking or wallet"], ["COD", "Cash on delivery"]] as const).map(
                ([value, text]) => (
                  <label key={value} className="flex cursor-pointer items-center gap-3 border border-[--color-rule] p-3">
                    <input type="radio" name="pay" checked={method === value} onChange={() => setMethod(value)} />
                    <span className="text-small">{text}</span>
                  </label>
                ),
              )}
            </div>
          </fieldset>

          {/* Unchecked by default, and separate from the order. A phone number
              given for delivery updates is not permission to send offers. */}
          <label className="mt-6 flex items-start gap-3 text-small">
            <input type="checkbox" className="mt-1" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} />
            <span>Send me occasional offers and new product news. You can stop this at any time.</span>
          </label>

          {/* Always mounted, not just when `error` is truthy — a live region has
              to already be present for assistive tech to announce a change
              into it; mounting it at the same time as the content would mean
              the announcement can be missed. */}
          <div aria-live="polite" role="status">
            {error && (
              <div className="mt-6 border-l-4 border-alert bg-shelf px-4 py-3">
                <p className="text-small font-semibold">{error}</p>
                {blocked.length > 0 && (
                  <ul className="mt-2 grid gap-1 text-small">
                    {blocked.map((b) => (
                      <li key={b.name}>
                        <strong>{b.name}</strong> — {b.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="panel">
            <div className="panel-head">Order summary</div>
            {quote ? (
              <dl>
                <div className="panel-row">
                  <dt>Items</dt>
                  <dd>{formatINR(quote.listSubtotalPaise)}</dd>
                </div>
                {quote.productDiscountPaise > 0 && (
                  <div className="panel-row">
                    <dt>Product discounts</dt>
                    <dd className="text-veg">−{formatINR(quote.productDiscountPaise)}</dd>
                  </div>
                )}
                {quote.bundleDiscountPaise > 0 && (
                  <div className="panel-row">
                    <dt>Bundle offer ({quote.appliedBundles.map((b: any) => b.name).join(", ")})</dt>
                    <dd className="text-veg">−{formatINR(quote.bundleDiscountPaise)}</dd>
                  </div>
                )}
                {quote.discountPaise > 0 && (
                  <div className="panel-row">
                    <dt>Discount</dt>
                    <dd className="text-veg">−{formatINR(quote.discountPaise)}</dd>
                  </div>
                )}
                <div className="panel-row">
                  <dt>Delivery</dt>
                  <dd>{quote.shippingPaise === 0 ? "Free" : formatINR(quote.shippingPaise)}</dd>
                </div>
                <div className="panel-row text-ink-faint">
                  <dt>of which GST</dt>
                  <dd>{formatINR(quote.taxPaise)}</dd>
                </div>
                <div className="panel-row font-display text-lead font-bold">
                  <dt>Total</dt>
                  <dd>{formatINR(quote.totalPaise)}</dd>
                </div>
              </dl>
            ) : (
              // A skeleton shaped like the real total, not bare "Loading…" text —
              // the re-quote is frequent enough (every pincode/coupon keystroke)
              // that a shape-shifting panel would be more distracting than this.
              <div className="grid gap-2 p-3.5" aria-live="polite" role="status">
                <span className="sr-only">Working out your total…</span>
                {[60, 45, 40, 70].map((width, i) => (
                  <div key={i} className="flex justify-between">
                    <div className="h-3 animate-pulse bg-shelf" style={{ width: `${width}%`, borderRadius: "var(--radius-panel)" }} />
                    <div className="h-3 w-14 animate-pulse bg-shelf" style={{ borderRadius: "var(--radius-panel)" }} />
                  </div>
                ))}
              </div>
            )}

            <div className="p-3.5">
              <button onClick={submit} disabled={busy} className="btn btn-solid w-full">
                {busy ? "Working…" : method === "COD" ? "Place order" : "Pay now"}
              </button>
              <p className="mt-3 text-micro text-ink-faint">
                Card details are handled by Razorpay and never reach our servers.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
