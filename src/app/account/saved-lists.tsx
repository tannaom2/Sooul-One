"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useCart } from "@/components/basket/cart-provider";
import { removeMyAddress, removeMyBox } from "./saved-actions";

type SavedBox = {
  id: string;
  name: string;
  boxId: string;
  boxName: string;
  boxSlug: string;
  available: boolean;
  picks: { productId: string; quantity: number }[];
  items: { name: string; quantity: number }[];
};

/**
 * Saved boxes on the account page (benchmark gap R4): put one in the basket
 * in a tap. The basket checks the box's rules and stock as for any box; if a
 * pick has sold out, the drawer says which, and "Change picks" opens the box
 * builder with this box loaded.
 */
export function SavedBoxes({ boxes }: { boxes: SavedBox[] }) {
  const { saveBox, pending } = useCart();
  const [failed, setFailed] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();
  return (
    <ul className="mt-4 grid gap-3">
      {boxes.map((b) => (
        <li key={b.id} className="panel p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">{b.name}</p>
            <p className="text-micro text-ink-faint">{b.boxName}</p>
          </div>
          <p className="mt-1 text-small text-ink-soft">{b.items.map((i) => (i.quantity > 1 ? `${i.name} × ${i.quantity}` : i.name)).join(", ")}</p>
          {b.available ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn btn-solid"
                disabled={pending}
                onClick={async () => {
                  setFailed(null);
                  const ok = await saveBox({ boxId: b.boxId, picks: b.picks });
                  if (!ok) setFailed(b.id);
                }}
              >
                Add to basket
              </button>
              <Link href={`/box/${b.boxSlug}?saved=${b.id}`} className="text-small underline">
                Change picks
              </Link>
              <button type="button" className="text-small text-ink-faint underline" disabled={removing} onClick={() => startRemove(async () => void (await removeMyBox(b.id)))}>
                Remove
              </button>
            </div>
          ) : (
            <p className="mt-3 text-small text-ink-faint">
              This box isn&apos;t offered any more.{" "}
              <button type="button" className="underline" disabled={removing} onClick={() => startRemove(async () => void (await removeMyBox(b.id)))}>
                Remove it
              </button>
            </p>
          )}
          {failed === b.id && (
            <p role="status" className="mt-2 text-small text-alert">
              It didn&apos;t all fit today: see your basket for why, or{" "}
              <Link href={`/box/${b.boxSlug}?saved=${b.id}`} className="underline">
                swap a pick
              </Link>
              .
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The address book on the account page (benchmark gap C16). Checkout offers these. */
export function SavedAddresses({ addresses }: { addresses: { id: string; summary: string }[] }) {
  const [removing, start] = useTransition();
  return (
    <ul className="panel mt-4">
      {addresses.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-3 border-b border-rule px-3.5 py-3 text-small last:border-b-0">
          <span className="min-w-0">{a.summary}</span>
          <button type="button" className="shrink-0 text-ink-faint underline" disabled={removing} onClick={() => start(async () => void (await removeMyAddress(a.id)))}>
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
