"use client";

import { useEffect, useState } from "react";
import { formatPriceTag } from "@/lib/money";
import { useCart } from "../basket/cart-provider";

/**
 * Phone-only bar with the price and Add to basket, shown once the main buy
 * box has scrolled out of view. Label-first product pages are long by design,
 * and the button shouldn't disappear behind the nutrition panel. Hidden from
 * assistive tech while the main box is visible, so it isn't announced twice.
 */
export function StickyBuyBar({
  targetId,
  productId,
  name,
  pricePaise,
  note,
}: {
  /** id of the main buy box to watch. */
  targetId: string;
  productId: string;
  name: string;
  pricePaise: number;
  /** A short line under the price, e.g. the delivery estimate. */
  note?: string;
}) {
  const { add, pending } = useCart();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetId]);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-[--color-rule] bg-paper/95 px-4 pt-3 backdrop-blur transition-transform duration-200 motion-reduce:transition-none lg:hidden ${visible ? "translate-y-0" : "translate-y-full"}`}
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      aria-hidden={!visible}
      inert={!visible}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="tabular font-display text-lead font-bold">{formatPriceTag(pricePaise)}</p>
          {note && <p className="truncate text-micro text-ink-faint">{note}</p>}
        </div>
        <button type="button" onClick={() => add(productId, 1)} disabled={pending} className="btn btn-solid px-5" aria-label={`Add ${name} to basket`}>
          Add to basket
        </button>
      </div>
    </div>
  );
}
