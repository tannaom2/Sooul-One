"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef } from "react";
import { formatINR, formatPriceTag } from "@/lib/money";
import { useCart } from "./cart-provider";
import { QuantityStepper } from "./quantity-stepper";

/**
 * Slide-over basket. Opens on add-to-basket and from the menu, so adding a
 * product never takes the shopper away from what they were browsing.
 * A modal dialog: focus moves in on open, Tab stays inside, Escape and the
 * backdrop close it, and focus returns to whatever opened it.
 */
export function BasketDrawer() {
  const { basket, count, isOpen, pending, error, closeBasket, setQuantity, add, removeUnavailable } = useCart();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeBasket();
      if (e.key !== "Tab" || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = scroll;
      // Back to whatever opened the drawer; if that control is now disabled
      // (an Add button mid-save) or gone, to the menu basket button instead.
      const back = returnFocus.current as HTMLButtonElement | null;
      if (back && back.isConnected && !back.disabled) back.focus();
      else document.querySelector<HTMLElement>("[aria-haspopup=dialog]")?.focus();
    };
  }, [isOpen, closeBasket]);

  const lines = basket?.lines ?? [];
  const loading = isOpen && !basket;

  return (
    <div className={`fixed inset-0 z-[60] ${isOpen ? "" : "pointer-events-none"}`} aria-hidden={!isOpen} inert={!isOpen}>
      <div
        className={`absolute inset-0 bg-ink/40 transition-opacity duration-200 motion-reduce:transition-none ${isOpen ? "opacity-100" : "opacity-0"}`}
        onClick={closeBasket}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="basket-title"
        className={`absolute top-0 right-0 flex h-full w-full max-w-md flex-col bg-paper shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none ${isOpen ? "translate-x-0" : "translate-x-full"}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-4">
          <h2 id="basket-title" className="text-h3 font-bold">
            Your basket{count > 0 && <span className="ml-2 text-small font-normal text-ink-faint">{count} {count === 1 ? "item" : "items"}</span>}
          </h2>
          {pending && basket && <span className="ml-auto mr-2 text-micro text-ink-faint">Updating…</span>}
          <button ref={closeButton} type="button" onClick={closeBasket} className="grid h-11 w-11 place-items-center text-h3" aria-label="Close basket">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div aria-live="polite" role="status">
            {error && <p className="mb-4 border-l-4 border-alert bg-shelf px-3 py-2 text-small">{error}</p>}
          </div>

          {loading ? (
            <div className="grid gap-3" aria-busy="true">
              <span className="sr-only">Loading your basket…</span>
              {[0, 1].map((i) => (
                <div key={i} className="h-20 animate-pulse bg-shelf" style={{ borderRadius: "var(--radius-panel)" }} />
              ))}
            </div>
          ) : lines.length === 0 ? (
            <div className="py-10 text-center">
              <p className="font-semibold">Nothing in your basket yet</p>
              <p className="mt-1 text-small text-ink-soft">Snacks and gummies ship together in one parcel.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link href="/true-store" onClick={closeBasket} className="btn btn-solid px-4 py-2 text-small">Shop snacks</Link>
                <Link href="/gummies" onClick={closeBasket} className="btn btn-outline px-4 py-2 text-small">Shop gummies</Link>
              </div>
            </div>
          ) : (
            <>
              {basket && (
                <div className="mb-5" aria-live="polite">
                  <p className="text-small font-semibold">
                    {basket.freeDelivery.qualified ? (
                      <span className="text-veg">You&rsquo;ve unlocked free delivery</span>
                    ) : (
                      <>Add {formatINR(basket.freeDelivery.gapPaise)} more for free delivery</>
                    )}
                  </p>
                  <div className="mt-2 h-2 overflow-hidden bg-shelf" style={{ borderRadius: 999 }} aria-hidden>
                    <div
                      className="h-full transition-[width] duration-300 motion-reduce:transition-none"
                      style={{ width: `${Math.round(basket.freeDelivery.fraction * 100)}%`, background: basket.freeDelivery.qualified ? "var(--color-veg)" : "var(--color-ink)" }}
                    />
                  </div>
                </div>
              )}

              {basket?.nextOffer && (
                <div className="mb-5 border border-rule bg-shelf p-3" style={{ borderRadius: "var(--radius-panel)" }}>
                  <p className="text-small font-semibold">
                    Add {basket.nextOffer.missing} more to get {basket.nextOffer.discountLabel}
                  </p>
                  <p className="text-micro text-ink-soft">{basket.nextOffer.name}</p>
                  <ul className="mt-2 grid gap-2">
                    {basket.nextOffer.suggestions.map((s) => (
                      <li key={s.productId} className="flex items-center justify-between gap-2 text-small">
                        <Link href={`/product/${s.slug}`} onClick={closeBasket} className="min-w-0 truncate hover:underline">
                          {s.name}
                        </Link>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tabular">{formatPriceTag(s.pricePaise)}</span>
                          <button type="button" onClick={() => add(s.productId, 1)} disabled={pending} className="btn btn-outline px-3 py-1 text-micro">
                            Add
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <ul className="grid gap-4">
                {lines.map((line) => (
                  <li key={line.itemId} className="flex gap-3 border-b border-rule pb-4 last:border-b-0">
                    {line.imageUrl ? (
                      <Image src={line.imageUrl} alt="" width={64} height={64} sizes="64px" className="h-16 w-16 shrink-0 border border-rule object-cover" />
                    ) : (
                      <div className="h-16 w-16 shrink-0 bg-shelf" style={{ borderRadius: "var(--radius-panel)" }} aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <Link href={`/product/${line.slug}`} onClick={closeBasket} className="block text-small font-semibold hover:underline">
                        {line.name}
                      </Link>
                      <p className="text-micro text-ink-faint">{line.brandName}</p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <QuantityStepper value={line.quantity} min={0} label={line.name} onChange={(q) => setQuantity(line.itemId, q)} />
                        <span className="tabular text-small">
                          {line.listUnitPaise > line.unitPaise && (
                            <s className="mr-1 text-ink-faint">{formatPriceTag(line.listUnitPaise * line.quantityAvailable)}</s>
                          )}
                          {formatPriceTag(line.lineTotalPaise)}
                        </span>
                      </div>
                      {line.message && <p className="mt-2 border-l-4 border-alert bg-shelf px-2 py-1 text-micro">{line.message}</p>}
                      {line.priceNote && <p className="mt-2 border-l-4 border-rule bg-shelf px-2 py-1 text-micro">{line.priceNote}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {basket && lines.length > 0 && (
          <div className="border-t border-rule px-5 py-4">
            <dl className="grid gap-1 text-small">
              {basket.savingsPaise > 0 && (
                <div className="flex justify-between text-veg">
                  <dt>You save</dt>
                  <dd className="tabular">{formatINR(basket.savingsPaise)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt>Delivery</dt>
                <dd className="tabular">{basket.shippingPaise === 0 ? "Free" : formatINR(basket.shippingPaise)}</dd>
              </div>
              <div className="flex justify-between font-display text-lead font-bold">
                <dt>Total</dt>
                <dd className="tabular">{formatINR(basket.totalPaise)}</dd>
              </div>
              <p className="text-micro text-ink-faint">Includes GST. Nothing more is added at checkout.</p>
            </dl>
            {basket.canProceed ? (
              <Link href="/checkout" onClick={closeBasket} className="btn btn-solid mt-3 w-full">
                Checkout · {formatINR(basket.totalPaise)}
              </Link>
            ) : (
              <>
                <p className="mt-3 text-small text-alert">Some items can&rsquo;t ship as they are.</p>
                <button type="button" onClick={() => void removeUnavailable()} disabled={pending} className="btn btn-solid mt-2 w-full">
                  Remove unavailable items
                </button>
              </>
            )}
            <Link href="/cart" onClick={closeBasket} className="mt-2 block text-center text-small underline">
              View full basket
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
