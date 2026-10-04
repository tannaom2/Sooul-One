"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPriceTag } from "@/lib/money";
import type { BasketBox } from "@/lib/basket-types";
import { cartonContents } from "@/lib/box-carton";
import { BoxCarton } from "@/components/box-carton";
import { useCart } from "./cart-provider";
import { saveMyBox, type SavedResult } from "@/app/account/saved-actions";

/**
 * A box the shopper built, as one row shaped like an item's: the open carton
 * with its packs inside where the photo goes, then "Gummies Box, Box of
 * Gummies · 3 packs, ₹999". Edit reopens the box page with these picks; a box
 * that needs attention (an item sold out or left the box) says what to do,
 * and its items stay at their usual prices until it's fixed. One the owner
 * has switched off can only be removed. `tile` is the picture's size: 64 in
 * the drawer, 88 on the basket page.
 */
export function BoxBlock({ box, refreshPage = false, onNavigate, tile = 64 }: { box: BasketBox; refreshPage?: boolean; onNavigate?: () => void; tile?: number }) {
  const { removeBox, pending: cartPending } = useCart();
  const [refreshing, startTransition] = useTransition();
  const router = useRouter();
  const pending = cartPending || refreshing;

  const remove = () =>
    startTransition(async () => {
      await removeBox(box.cartBoxId);
      if (refreshPage) router.refresh();
    });

  // "Save for next time" (src/server/saved-boxes.ts): right here, because
  // this drawer opens over the box page's own save option.
  const [saved, setSaved] = useState<SavedResult | null>(null);
  const [saving, startSave] = useTransition();
  const save = () =>
    startSave(async () => {
      setSaved(await saveMyBox({ boxId: box.boxId, name: `My ${box.name}`, picks: box.items.map((i) => ({ productId: i.productId, quantity: i.quantity })) }));
    });

  const complete = box.issue === null;
  const units = box.items.reduce((n, i) => n + i.quantity, 0);
  const { shown, more } = cartonContents(box.items.map((i) => ({ picture: i.imageUrl, quantity: i.quantity })));
  const wide = tile >= 80;
  return (
    <div className={`flex ${wide ? "gap-4" : "gap-3"}`}>
      <div className="shrink-0 self-start border border-rule bg-surface" style={{ width: tile, height: tile }}>
        <BoxCarton packs={shown} more={more} complete={complete} width={tile - 2} height={tile - 2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`font-semibold ${wide ? "" : "text-small"}`}>{box.name}</p>
            <p className="text-micro text-ink-faint">
              {box.available && `${box.kindLabel} · `}
              {units} {units === 1 ? "pack" : "packs"}
            </p>
          </div>
          <p className="tabular shrink-0 text-right text-small">
            <span className="block font-semibold">{formatPriceTag(box.finalPaise)}</span>
            {box.savingPaise > 0 && <s className="text-micro text-ink-faint">{formatPriceTag(box.listPaise)}</s>}
          </p>
        </div>

        <p className="mt-1.5 text-micro text-ink-soft">
          {box.items.map((item, i) => (
            <span key={item.productId}>
              {i > 0 && " · "}
              {item.name}
              {item.quantity > 1 && <span className="tabular"> × {item.quantity}</span>}
            </span>
          ))}
        </p>
        {box.items
          .filter((item) => item.message)
          .map((item) => (
            <p key={item.productId} className="mt-1 text-micro text-alert">
              {item.name}: {item.message}
            </p>
          ))}

        {box.issue && <p className="mt-2 border-l-4 border-alert bg-shelf px-2 py-1 text-micro">{box.issue}</p>}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="flex items-center gap-3.5 text-micro">
            {/* A box that's been switched off has no page to go back to. */}
            {box.available && (
              <Link href={`/box/${box.slug}?edit=${box.cartBoxId}`} onClick={onNavigate} className="underline" aria-label={`${complete ? "Edit" : "Fix"} ${box.name}`}>
                {complete ? "Edit" : "Fix box"}
              </Link>
            )}
            <button type="button" onClick={remove} disabled={pending} className="underline hover:text-alert" aria-label={`Remove ${box.name}`}>
              Remove
            </button>
            {/* On the same line as Edit, so it's in view wherever the drawer is scrolled. */}
            {complete && box.available && !saved?.ok && !saved?.signIn && (
              <button type="button" onClick={save} disabled={saving} className="underline">
                {saving ? "Saving…" : "Save for later"}
              </button>
            )}
          </span>
          {complete && box.savingPaise > 0 && <span className="text-micro font-semibold text-veg">Save {formatPriceTag(box.savingPaise)}</span>}
        </div>

        {saved && (
          <p className="mt-2 text-micro" aria-live="polite">
            {saved.ok ? (
              <span className="text-veg">
                Saved to your boxes.{" "}
                <Link href="/account" onClick={onNavigate} className="underline">
                  See your boxes
                </Link>
              </span>
            ) : saved.signIn ? (
              <span className="text-ink-soft">
                <Link href="/account/sign-in" onClick={onNavigate} className="underline">
                  Sign in
                </Link>{" "}
                to save boxes and reorder them in one tap.
              </span>
            ) : (
              <span className="text-alert">{saved.message}</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
