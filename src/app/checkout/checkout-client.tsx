"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { formatPriceTag } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { track } from "@/lib/track";
import { MARKETING_CONSENT_TEXT } from "@/lib/consent";
import type { CheckoutState, PaymentMethod } from "@/lib/store-controls";
import { STEPS, normalise, stepSummary, validateStep, type CheckoutForm as FormValues, type CheckoutStep } from "@/lib/checkout/steps";
import { maskMobile } from "@/lib/mobile";
import { requestSignInCode } from "@/app/account/actions";
import { PhoneCodeForm, type CodeSent } from "@/components/account/phone-code-form";
import { Turnstile } from "@/components/turnstile";
import { useCheckout } from "./use-checkout";
import { useQuote } from "./use-quote";
import { usePincode } from "./use-pincode";
import { CHECKOUT_TIMEOUT_SECONDS } from "@/lib/order-lifecycle";
import { OUTSIDE_AREA_MESSAGE, SERVICE_AREA, inServicePincode } from "@/lib/checkout/service-area";

/**
 * Checkout, in three steps: contact, address, payment.
 *
 * Guest checkout is first class — no account wall. Mobile number comes first
 * (the smallest ask, and what delivery needs anyway); the pincode fills city
 * and state and shows the delivery date; UPI is offered first because it's
 * how most Indian shoppers pay. Totals are re-quoted on the server as the
 * pincode and coupon change, and again on submit, because a basket can
 * become non-compliant while someone is typing their address.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
  }
}

type PayChoice = "UPI" | "CARD" | "COD";

const STEP_TITLES: Record<CheckoutStep, string> = { contact: "Contact", address: "Delivery address", payment: "Payment" };

const PAY_OPTIONS: { value: PayChoice; title: string; detail: string }[] = [
  { value: "UPI", title: "UPI", detail: "Pay from any UPI app: PhonePe, Google Pay, Paytm." },
  { value: "CARD", title: "Card, net banking or wallet", detail: "Handled securely by Razorpay." },
  { value: "COD", title: "Cash on delivery", detail: "Pay the courier when it arrives. No extra charge." },
];

const noop = () => () => {};

/** The signed-in shopper, if any, and whether cash on delivery asks for a code here. */
export interface CheckoutAccount {
  readonly phone: string | null;
  readonly prefill: Partial<FormValues>;
  readonly codNeedsCode: boolean;
}

/**
 * The form restores a draft from sessionStorage, which only exists in the
 * browser, so it renders after hydration; the server sends the page frame.
 */
export function CheckoutClient({
  state,
  account,
  preferredPayment = "ONLINE",
  turnstileSiteKey = null,
  downMethods = [],
}: {
  state: CheckoutState;
  account: CheckoutAccount;
  /** Which way to pay is selected first (Store controls). */
  preferredPayment?: "ONLINE" | "COD";
  /** Set when Cloudflare Turnstile is on (src/lib/turnstile.ts). */
  turnstileSiteKey?: string | null;
  /** Payment methods Razorpay reports an outage for right now. */
  downMethods?: readonly string[];
}) {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  // Closed before launch, or paused by the owner (src/lib/store-controls.ts).
  if (!state.open) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16">
        <h1 className="text-h1 font-extrabold">{state.title}</h1>
        <p className="mt-2 text-ink-soft">{state.message}</p>
        <Link href="/" className="btn btn-outline mt-6">
          Keep browsing
        </Link>
      </div>
    );
  }
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-8 lg:py-12" aria-busy="true">
        <h1 className="text-h1 font-extrabold">Checkout</h1>
        <p className="mt-1 text-small text-ink-soft">No account needed</p>
      </div>
    );
  }
  return <CheckoutForm methods={state.methods} account={account} preferredPayment={preferredPayment} turnstileSiteKey={turnstileSiteKey} downMethods={downMethods} />;
}

function CheckoutForm({
  methods,
  account,
  preferredPayment,
  turnstileSiteKey,
  downMethods,
}: {
  methods: readonly PaymentMethod[];
  account: CheckoutAccount;
  preferredPayment: "ONLINE" | "COD";
  turnstileSiteKey: string | null;
  downMethods: readonly string[];
}) {
  const router = useRouter();
  const { form, step, errors, setErrors, set, setForm, next, edit, clearDraft } = useCheckout(account.prefill);
  // The number proven by code in this browser: the signed-in one, or the one
  // just confirmed below. Cash on delivery to any other number asks again.
  const [provenPhone, setProvenPhone] = useState(account.phone);
  const [codeSent, setCodeSent] = useState<CodeSent | null>(null);
  // One id per checkout visit, sent with every Place order: a double click or
  // a retry after a dropped connection gets the same order back, never two.
  const [attemptKey] = useState(() => crypto.randomUUID());
  const { quote, couponRejected, empty, creditNote, referralWaiting, cod } = useQuote(form.postalCode, form.state, form.couponCode);
  const place = usePincode(form.postalCode);
  // Only what this deployment can take right now: UPI and card once Razorpay
  // is set up, cash on delivery unless the owner has switched it off.
  const onlinePayments = methods.includes("ONLINE");
  const payOptions = PAY_OPTIONS.filter((o) => (o.value === "COD" ? methods.includes("COD") : onlinePayments));
  const [pay, setPay] = useState<PayChoice>(
    preferredPayment === "COD" && methods.includes("COD")
      ? "COD"
      : // UPI having trouble (Razorpay's notice or the owner's): start on card instead.
        downMethods.includes("upi") && onlinePayments
        ? "CARD"
        : (payOptions[0]?.value ?? "COD"),
  );
  // The owner's COD rules can rule it out for this pincode, number or total:
  // move to paying online, and show why on the cash on delivery option.
  const codOff = !cod.allowed;
  const payNow: PayChoice = codOff && pay === "COD" && onlinePayments ? "UPI" : pay;
  // Human check before an order is placed, when Turnstile is on.
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const [humanReset, setHumanReset] = useState(0);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [blocked, setBlocked] = useState<{ name: string; reason?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autofilled = useRef<{ city?: string; state?: string }>({});
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Once per visit: this page is where CHECKOUT_STARTED lives in the funnel.
  useEffect(() => {
    track({ type: "CHECKOUT_STARTED" });
  }, []);

  // Fill city and state from the pincode, but never overwrite what the
  // shopper typed themselves (only empty fields, or ones we filled before).
  useEffect(() => {
    if (!place?.city || !place.state) return;
    // Read what we filled last time now: the updater below runs later, after
    // the ref already holds this pincode's values, so a corrected pincode
    // would otherwise leave the first one's city and state behind.
    const previous = autofilled.current;
    setForm((f) => ({
      ...f,
      city: !f.city || f.city === previous.city ? place.city! : f.city,
      state: !f.state || f.state === previous.state ? place.state! : f.state,
    }));
    autofilled.current = { city: place.city, state: place.state };
  }, [place, setForm]);

  // Moving to a step puts focus at its heading, so keyboard and screen-reader
  // users land where the next thing to do is.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // Razorpay's script is large and only needed to pay, so it loads when the
  // payment step opens rather than with the page. Cash on delivery never needs it.
  useEffect(() => {
    if (!onlinePayments || step !== "payment" || document.getElementById("razorpay-checkout")) return;
    const script = document.createElement("script");
    script.id = "razorpay-checkout";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
  }, [step, onlinePayments]);

  function choosePay(value: PayChoice) {
    setPay(value);
    track({ type: "PAYMENT_METHOD_SELECTED", method: value });
  }

  function continueFrom() {
    const found = next();
    const first = Object.keys(found)[0];
    if (first) document.getElementById(first)?.focus();
  }

  /** Text a code to the order's number; the payment step then asks for it. */
  async function askForCode(phone: string) {
    const sent = await requestSignInCode(phone, humanToken);
    // That token is spent: the widget fetches a fresh one for placing the order.
    if (turnstileSiteKey) setHumanReset((n) => n + 1);
    if (sent.ok) {
      setCodeSent({ phone, sentTo: sent.sentTo, resendIn: sent.resendIn, demoCode: sent.demoCode });
    } else if (sent.resendIn) {
      // One went out moments ago (a double tap, or back from another step).
      setCodeSent({ phone, sentTo: maskMobile(phone), resendIn: sent.resendIn, note: "We sent you a code a moment ago." });
    } else {
      setError(sent.message);
    }
  }

  async function submit(justProven?: string) {
    // Re-check the earlier steps directly: a restored draft may have skipped
    // one, and a server rule could have changed. Send the shopper back to the
    // first step with a problem.
    for (const s of ["contact", "address"] as const) {
      const found = validateStep(s, form);
      if (Object.keys(found).length) {
        edit(s);
        setErrors(found);
        return;
      }
    }
    setBusy(true);
    setError(null);
    setBlocked([]);

    try {
      const clean = normalise(form);
      if (payNow === "COD" && account.codNeedsCode && clean.phone !== (justProven ?? provenPhone)) {
        await askForCode(clean.phone);
        return;
      }
      const response = await fetch("/api/checkout/create-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attemptKey,
          ...(humanToken ? { "X-Turnstile-Token": humanToken } : {}),
        },
        body: JSON.stringify({
          ...clean,
          line2: clean.line2 || undefined,
          couponCode: clean.couponCode || undefined,
          paymentMethod: payNow === "COD" ? "COD" : "RAZORPAY",
          marketingConsent,
        }),
      });
      const body = await response.json();
      // A human-check token works once: any answer from the server used it up.
      if (turnstileSiteKey) setHumanReset((n) => n + 1);

      if (response.status === 409) {
        setBlocked(body.blocked ?? []);
        setError(body.message);
        return;
      }
      // The server's own check (a session that ended, another tab signed out).
      if (response.status === 403 && body.code === "PHONE_CODE_REQUIRED") {
        setProvenPhone(null);
        await askForCode(clean.phone);
        return;
      }
      if (!response.ok) {
        if (Array.isArray(body.issues)) {
          const serverErrors: Record<string, string> = {};
          for (const issue of body.issues) {
            const key = String(issue.path?.[0] ?? "");
            if (key && !serverErrors[key]) serverErrors[key] = issue.message;
          }
          setErrors(serverErrors);
          if (serverErrors.phone || serverErrors.email) edit("contact");
          else if (Object.keys(serverErrors).length) edit("address");
        }
        setError(body.message ?? "That didn't go through. Check your details and try again.");
        return;
      }

      if (body.method === "COD") {
        clearDraft();
        router.replace(`/order/${body.orderNumber}?t=${body.accessToken}`);
        return;
      }

      // Hosted Checkout: card data never touches this application, which is
      // what keeps PCI scope at SAQ-A.
      if (!window.Razorpay) {
        setError("The payment window is still loading. Wait a moment and try again, or choose cash on delivery.");
        return;
      }
      new window.Razorpay({
        key: body.keyId,
        amount: body.amount,
        currency: "INR",
        name: "SooulOne",
        order_id: body.razorpayOrderId,
        // Close the window well before the unpaid sweep closes the order (launch defect D2).
        timeout: CHECKOUT_TIMEOUT_SECONDS,
        prefill: { name: clean.name, email: clean.email, contact: clean.phone, ...(payNow === "UPI" && { method: "upi" }) },
        handler: () => {
          clearDraft();
          router.replace(`/order/${body.orderNumber}?t=${body.accessToken}`);
        },
        modal: {
          ondismiss: () => {
            setBusy(false);
            track({ type: "PAYMENT_DISMISSED", method: payNow === "UPI" ? "UPI" : "CARD" });
          },
        },
      }).open();
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (empty) {
    return (
      <div className="mx-auto max-w-lg px-5 py-24 text-center">
        <h1 className="text-h2 font-extrabold">Your basket is empty</h1>
        <p className="mt-3 text-ink-soft">Add something first, then come back to check out.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/true-store" className="btn btn-solid">Shop snacks</Link>
          <Link href="/gummies" className="btn btn-outline">Shop gummies</Link>
        </div>
      </div>
    );
  }

  const total = quote ? formatPriceTag(quote.totalPaise) : null;
  // Out of area as soon as a full pincode is typed: by range, or by India Post's state.
  const outsideArea = place?.serviceable === false || (/^\d{6}$/.test(form.postalCode) && !inServicePincode(form.postalCode));
  const stepIndex = STEPS.indexOf(step);
  const codNeedsCodeNow = account.codNeedsCode && normalise(form).phone !== provenPhone;
  // Only for the number still on the form, and only while paying on delivery.
  const showCode = codeSent !== null && payNow === "COD" && codeSent.phone === normalise(form).phone;
  const payLabel = !total ? "Place order" : payNow === "COD" ? `Place order · pay ${total} on delivery` : `Pay ${total}${payNow === "UPI" ? " with UPI" : ""}`;
  const humanPending = Boolean(turnstileSiteKey) && !humanToken;

  const field = (
    id: keyof typeof form,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className={props.className}>
      <label className="label" htmlFor={id}>{label}</label>
      <input
        {...props}
        id={id}
        className="field"
        value={form[id]}
        onChange={(e) => set(id, e.target.value)}
        aria-invalid={Boolean(errors[id]) || undefined}
        aria-describedby={errors[id] ? `${id}-error` : undefined}
      />
      {errors[id] && <p id={`${id}-error`} className="mt-1 text-micro text-alert">{errors[id]}</p>}
    </div>
  );

  const summary = (
    <div className="panel">
      {/* Items and kits are changed in the basket, which checkout reads live. */}
      <div className="panel-head flex items-baseline justify-between gap-3">
        <span>Order summary</span>
        <Link href="/cart" className="text-small font-normal underline">
          Edit basket
        </Link>
      </div>
      {quote ? (
        <dl>
          <div className="panel-row"><dt>Items</dt><dd>{formatPriceTag(quote.listSubtotalPaise)}</dd></div>
          {quote.productDiscountPaise > 0 && (
            <div className="panel-row"><dt>Product discounts</dt><dd className="text-veg">−{formatPriceTag(quote.productDiscountPaise)}</dd></div>
          )}
          {quote.bundleDiscountPaise > 0 && (
            <div className="panel-row"><dt>Combo savings ({[...quote.appliedBundles, ...(quote.appliedBoxes ?? [])].map((b: any) => b.name).join(", ")})</dt><dd className="text-veg">−{formatPriceTag(quote.bundleDiscountPaise)}</dd></div>
          )}
          {quote.discountPaise > 0 && (
            <div className="panel-row"><dt>Discount code</dt><dd className="text-veg">−{formatPriceTag(quote.discountPaise)}</dd></div>
          )}
          {quote.creditPaise > 0 && (
            <div className="panel-row"><dt>{creditNote ?? "Referral credit"}</dt><dd className="text-veg">−{formatPriceTag(quote.creditPaise)}</dd></div>
          )}
          <div className="panel-row"><dt>Delivery</dt><dd>{quote.shippingPaise === 0 ? "Free" : formatPriceTag(quote.shippingPaise)}</dd></div>
          <div className="panel-row text-ink-faint"><dt>of which GST</dt><dd>{formatPriceTag(quote.taxPaise)}</dd></div>
          <div className="panel-row font-display text-lead font-bold"><dt>Total</dt><dd>{formatPriceTag(quote.totalPaise)}</dd></div>
        </dl>
      ) : (
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
      {quote && creditNote && quote.creditPaise === 0 && quote.creditShortfallPaise > 0 && (
        <p className="px-3.5 pb-2 text-micro text-veg">
          {creditNote}: add {formatPriceTag(quote.creditShortfallPaise)} more to use it.
        </p>
      )}
      {quote && creditNote && quote.creditBlockedByCoupon && (
        <p className="px-3.5 pb-2 text-micro text-ink-soft">{creditNote} can&rsquo;t be combined with a discount code. Remove the code to use it instead.</p>
      )}
      {referralWaiting && !account.phone && (
        <p className="px-3.5 pb-2 text-micro">
          You have a friend&rsquo;s offer waiting.{" "}
          <Link href="/account/sign-in?next=/checkout" className="underline">Sign in with your number</Link> to use it.
        </p>
      )}
      <p className="px-3.5 pb-3 text-micro text-ink-faint">Nothing is added after this: no handling, packing or COD fees.</p>
    </div>
  );

  return (
    <>
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 lg:grid-cols-[1fr_340px] lg:py-12">
        <div>
          <h1 className="text-h1 font-extrabold">Checkout</h1>
          <p className="mt-1 text-small text-ink-soft">
            {account.phone ? (
              <>Signed in with <span className="tabular">{maskMobile(account.phone)}</span></>
            ) : (
              <>
                No account needed
                {account.codNeedsCode && (
                  <>
                    {" "}·{" "}
                    <Link href="/account/sign-in?next=/checkout" className="underline">Sign in</Link>
                  </>
                )}
              </>
            )}{" "}
            · Step {stepIndex + 1} of 3
          </p>

          {/* Phones: the total, collapsible, before the form. */}
          <details className="mt-5 lg:hidden">
            <summary className="flex cursor-pointer items-center justify-between border border-rule px-3.5 py-3 text-small font-semibold" style={{ borderRadius: "var(--radius-panel)" }}>
              <span>Order summary</span>
              <span className="tabular">
                {total ?? "…"} <span aria-hidden className="ml-1 text-ink-faint">▾</span>
              </span>
            </summary>
            <div className="mt-2">{summary}</div>
          </details>

          <ol className="mt-6 grid gap-4">
            {STEPS.map((s, i) => {
              const active = s === step;
              const done = i < stepIndex;
              return (
                <li key={s} className="panel" aria-current={active ? "step" : undefined}>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <h2
                      ref={active ? headingRef : undefined}
                      tabIndex={active ? -1 : undefined}
                      className={`font-display text-lead font-bold outline-none ${active || done ? "" : "text-ink-faint"}`}
                    >
                      <span className="tabular mr-2 text-ink-faint">{i + 1}</span>
                      {STEP_TITLES[s]}
                      {done && <span className="ml-2 text-small font-normal text-veg">✓</span>}
                    </h2>
                    {done && (
                      <button type="button" onClick={() => edit(s)} className="text-small underline">
                        Change
                      </button>
                    )}
                  </div>
                  {done && <p className="px-4 pb-3 text-small text-ink-soft">{stepSummary(s, normalise(form))}</p>}

                  {active && s === "contact" && (
                    <div className="grid gap-4 border-t border-rule p-4 sm:grid-cols-2">
                      {field("phone", "Mobile number", { type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "98765 43210", autoFocus: true })}
                      {field("email", "Email, for your receipt", { type: "email", autoComplete: "email", spellCheck: false })}
                      <button type="button" onClick={continueFrom} className="btn btn-solid sm:col-span-2 sm:justify-self-start">
                        Continue to address
                      </button>
                    </div>
                  )}

                  {active && s === "address" && (
                    <div className="grid gap-4 border-t border-rule p-4 sm:grid-cols-2">
                      <div>
                        {field("postalCode", "Pincode", { inputMode: "numeric", autoComplete: "postal-code", maxLength: 6 })}
                        <p className={`mt-1 text-micro ${outsideArea ? "text-alert" : "text-ink-faint"}`} aria-live="polite" hidden={Boolean(errors.postalCode)}>
                          {outsideArea
                            ? OUTSIDE_AREA_MESSAGE
                            : place?.notFound
                              ? "We couldn't find that pincode. Check it, or type the city and state."
                              : place?.arrivesBy
                                ? `Arrives by ${formatDate(place.arrivesBy)} at the latest`
                                : `We deliver within ${SERVICE_AREA.label}. Fills in your city and state.`}
                        </p>
                      </div>
                      {field("name", "Full name", { autoComplete: "name" })}
                      {field("line1", "House, street and area", { autoComplete: "address-line1", className: "sm:col-span-2" })}
                      {field("line2", "Landmark (optional)", { autoComplete: "address-line2", className: "sm:col-span-2" })}
                      {field("city", "City or district", { autoComplete: "address-level2" })}
                      {field("state", "State", { autoComplete: "address-level1" })}
                      <button type="button" onClick={continueFrom} className="btn btn-solid sm:col-span-2 sm:justify-self-start">
                        Continue to payment
                      </button>
                    </div>
                  )}

                  {active && s === "payment" && (
                    <div className="grid gap-4 border-t border-rule p-4">
                      <fieldset>
                        <legend className="sr-only">How would you like to pay?</legend>
                        <div className="grid gap-2">
                          {payOptions.map((o) => {
                            const unavailable = o.value === "COD" && codOff;
                            // Razorpay reports an outage for this way to pay: say so, don't hide it.
                            const troubled = o.value === "UPI" ? downMethods.includes("upi") : o.value === "CARD" && ["card", "netbanking"].some((m) => downMethods.includes(m));
                            return (
                              <label
                                key={o.value}
                                className={`flex items-start gap-3 border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${unavailable ? "cursor-not-allowed border-rule" : "cursor-pointer"} ${payNow === o.value ? "border-strong bg-shelf" : "border-rule"}`}
                                style={{ borderRadius: "var(--radius-panel)" }}
                              >
                                <input
                                  type="radio"
                                  name="pay"
                                  className="mt-1"
                                  checked={payNow === o.value}
                                  disabled={unavailable}
                                  aria-describedby={unavailable ? "cod-unavailable" : undefined}
                                  onChange={() => choosePay(o.value)}
                                />
                                <span>
                                  <span className="block text-small font-semibold">{o.title}</span>
                                  {unavailable ? (
                                    <span id="cod-unavailable" className="block text-micro text-ink-soft">
                                      {onlinePayments ? cod.message : "Cash on delivery isn't available for this order, and online payment isn't set up yet, so it can't be placed right now."}
                                    </span>
                                  ) : (
                                    <span className="block text-micro text-ink-soft">
                                      {o.detail}
                                      {o.value === "COD" && codNeedsCodeNow && " We'll text you a code to confirm your number."}
                                      {troubled && <span className="block font-semibold text-caution">Having trouble right now: another way to pay may be quicker.</span>}
                                    </span>
                                  )}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>

                      <div className="max-w-xs">
                        <label className="label" htmlFor="couponCode">Discount code (optional)</label>
                        <input id="couponCode" className="field" autoComplete="off" spellCheck={false} value={form.couponCode} onChange={(e) => set("couponCode", e.target.value.toUpperCase())} />
                        {couponRejected && form.couponCode && <p className="mt-1 text-micro text-alert">{couponRejected}</p>}
                      </div>

                      {/* Unchecked by default, and separate from the order. A phone number
                          given for delivery updates is not permission to send offers. */}
                      <label className="flex items-start gap-3 text-small">
                        <input type="checkbox" className="mt-1" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} />
                        <span>{MARKETING_CONSENT_TEXT}</span>
                      </label>

                      {showCode && codeSent ? (
                        <div className="border-t border-rule pt-4">
                          <p className="mb-3 text-small font-semibold">Confirm your number to place this cash on delivery order</p>
                          <PhoneCodeForm
                            key={codeSent.phone}
                            turnstileSiteKey={turnstileSiteKey}
                            sent={codeSent}
                            submitLabel={total ? `Confirm and place order · pay ${total} on delivery` : "Confirm and place order"}
                            onChangeNumber={() => {
                              setCodeSent(null);
                              edit("contact");
                            }}
                            onVerified={async () => {
                              const phone = codeSent.phone;
                              setProvenPhone(phone);
                              setCodeSent(null);
                              await submit(phone);
                            }}
                          />
                          <p className="mt-3 text-micro text-ink-faint">
                            This also saves your details: next time, sign in with this number and checkout fills itself in.
                          </p>
                        </div>
                      ) : (
                        <>
                          <Turnstile siteKey={turnstileSiteKey} action="checkout" onToken={setHumanToken} resetKey={humanReset} />
                          <button onClick={() => submit()} disabled={busy || !quote?.canProceed || humanPending || (codOff && payNow === "COD")} className="btn btn-solid w-full sm:w-auto sm:justify-self-start">
                            {busy ? "Working…" : payLabel}
                          </button>
                        </>
                      )}
                      {quote && !quote.canProceed && (
                        <p className="text-small text-alert">Some items can&rsquo;t ship right now. <Link href="/cart" className="underline">Review your basket</Link>.</p>
                      )}
                      {onlinePayments && (
                        <p className="text-micro text-ink-faint">Card and UPI details are handled by Razorpay and never reach our servers.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {/* Always mounted so assistive tech is already watching the region. */}
          <div aria-live="polite" role="status">
            {error && (
              <div className="mt-6 border-l-4 border-alert bg-shelf px-4 py-3">
                <p className="text-small font-semibold">{error}</p>
                {blocked.length > 0 && (
                  <ul className="mt-2 grid gap-1 text-small">
                    {blocked.map((b) => (
                      <li key={b.name}><strong>{b.name}</strong> — {b.reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">{summary}</aside>
      </div>
    </>
  );
}
