"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPriceTag } from "@/lib/money";
import type { BasketBox } from "@/lib/basket-types";
import { useCart } from "./cart-provider";

/**
 * A box the shopper built, as one block: "Gummies Box, 3 items, ₹999, you
 * save ₹448". Edit reopens the box page with these picks; a box that needs
 * attention (an item sold out or left the box) says what to do, and its
 * items stay at their usual prices until it's fixed. One the owner has
 * switched off can only be removed.
 */
export function BoxBlock({ box, refreshPage = false, onNavigate }: { box: BasketBox; refreshPage?: boolean; onNavigate?: () => void }) {
  const { removeBox, pending: cartPending } = useCart();
  const [refreshing, startTransition] = useTransition();
  const router = useRouter();
  const pending = cartPending || refreshing;

  const remove = () =>
    startTransition(async () => {
      await removeBox(box.cartBoxId);
      if (refreshPage) router.refresh();
    });

  const complete = box.issue === null;
  return (
    <div className={`border p-3.5 ${complete ? "border-rule bg-shelf" : "border-alert bg-surface"}`} style={{ borderRadius: "var(--radius-panel)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-micro font-semibold tracking-wide text-veg uppercase">Your box{box.available && ` · ${box.kindLabel}`}</p>
          <p className="font-semibold">{box.name}</p>
        </div>
        <p className="tabular shrink-0 text-right text-small">
          <span className="block font-semibold">{formatPriceTag(box.finalPaise)}</span>
          {box.savingPaise > 0 && <s className="text-micro text-ink-faint">{formatPriceTag(box.listPaise)}</s>}
        </p>
      </div>

      <ul className="mt-2 grid gap-0.5 text-small text-ink-soft">
        {box.items.map((item) => (
          <li key={item.productId}>
            <span className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                {item.name}
                <span className="text-micro text-ink-faint"> · {item.brandName}</span>
              </span>
              {item.quantity > 1 && <span className="tabular shrink-0 text-ink-faint">× {item.quantity}</span>}
            </span>
            {item.message && <span className="mt-0.5 block text-micro text-alert">{item.message}</span>}
          </li>
        ))}
      </ul>

      {box.issue && <p className="mt-2 border-l-4 border-alert bg-shelf px-2 py-1 text-micro">{box.issue}</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-4 text-small">
          {/* A box that's been switched off has no page to go back to. */}
          {box.available && (
            <Link href={`/box/${box.slug}?edit=${box.cartBoxId}`} onClick={onNavigate} className="underline">
              {complete ? "Edit box" : "Fix box"}
            </Link>
          )}
          <button type="button" onClick={remove} disabled={pending} className="text-micro underline hover:text-alert">
            Remove box
          </button>
        </span>
        {complete && box.savingPaise > 0 && <span className="text-small font-semibold text-veg">You save {formatPriceTag(box.savingPaise)}</span>}
      </div>
    </div>
  );
}
