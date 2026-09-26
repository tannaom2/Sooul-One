"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { formatPriceTag } from "@/lib/money";
import type { ComboOffer } from "@/server/catalog";
import { useCart } from "../basket/cart-provider";

/**
 * "Save with a combo" on a product page: each live bundle this product is in,
 * with the set shown, its combo price and saving (worked out by the basket's
 * own engine on the server), and one button to add the set. For mix-and-match
 * bundles the other products that also qualify are listed.
 *
 * The terms are stated where the price is: once per complete combo, not with
 * discount codes. Nothing is added unless the shopper presses the button.
 */
export function ProductCombos({ offers }: { offers: ComboOffer[] }) {
  if (offers.length === 0) return null;
  return (
    <section aria-labelledby="combos-h" className="panel mt-5">
      <h2 id="combos-h" className="panel-head">
        Save with a combo
      </h2>
      <div className="grid gap-5 p-3.5">
        {offers.map((offer) => (
          <Combo key={offer.bundleId} offer={offer} />
        ))}
      </div>
    </section>
  );
}

function Combo({ offer }: { offer: ComboOffer }) {
  const { addMany, pending } = useCart();
  const [added, setAdded] = useState(false);
  const percent = offer.salePaise > 0 ? Math.round((offer.savingPaise / offer.salePaise) * 100) : 0;

  return (
    <div className="grid gap-3">
      <div>
        <p className="font-semibold">{offer.name}</p>
        <p className="text-micro text-ink-soft">
          {offer.kind === "fixed"
            ? `Buy these together: ${offer.discountLabel}.`
            : `Any ${offer.minItems} of the products below: ${offer.discountLabel}.`}
          {offer.description ? ` ${offer.description}` : ""}
        </p>
      </div>

      <ul className="grid gap-2">
        {offer.items.map((item, i) => (
          <li key={item.productId} className="flex items-center gap-3">
            {item.imageUrl ? (
              <Image src={item.imageUrl} alt="" width={48} height={48} sizes="48px" className="h-12 w-12 shrink-0 border border-rule object-cover" />
            ) : (
              <span className="h-12 w-12 shrink-0 bg-shelf" aria-hidden />
            )}
            <span className="min-w-0 flex-1 text-small">
              {i === 0 ? (
                <span className="font-medium">This product</span>
              ) : (
                <Link href={`/product/${item.slug}`} className="hover:underline">
                  {item.name}
                </Link>
              )}
              {i === 0 && <span className="block truncate text-micro text-ink-faint">{item.name}</span>}
            </span>
            <span className="tabular text-small">{formatPriceTag(item.pricePaise)}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-rule pt-3">
        <p>
          <span className="block text-micro text-ink-faint">Combo price</span>
          <span className="tabular font-display text-lead font-bold">{formatPriceTag(offer.comboPaise)}</span>{" "}
          <s className="tabular text-small text-ink-faint">{formatPriceTag(offer.salePaise)}</s>{" "}
          <span className="text-small font-semibold text-veg">
            Save {formatPriceTag(offer.savingPaise)}
            {percent > 0 && ` (${percent}%)`}
          </span>
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            setAdded(false);
            if (await addMany(offer.items.map((i) => i.productId))) {
              setAdded(true);
              setTimeout(() => setAdded(false), 2000);
            }
          }}
          className="btn btn-solid px-4"
        >
          {added ? "Added ✓" : offer.items.length === 2 ? "Add both to basket" : `Add all ${offer.items.length} to basket`}
        </button>
      </div>

      {offer.alternatives.length > 0 && (
        <p className="text-micro text-ink-soft">
          Also counts towards this offer:{" "}
          {offer.alternatives.map((a, i) => (
            <span key={a.productId}>
              {i > 0 && ", "}
              <Link href={`/product/${a.slug}`} className="underline">
                {a.name}
              </Link>
            </span>
          ))}
          .
        </p>
      )}

      <p className="text-micro text-ink-faint">
        The combo price applies once per complete combo; extra units are at the usual price. It can&rsquo;t be combined with
        discount codes.
      </p>
    </div>
  );
}
