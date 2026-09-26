"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { formatPriceTag } from "@/lib/money";
import type { ComboOffer } from "@/server/catalog";
import { useCart } from "../basket/cart-provider";

/**
 * "Or buy as a kit" on a product page: each live bundle this product is in,
 * with the set shown, its combo price and saving (worked out by the basket's
 * own engine on the server), and one button to add the set. For mix-and-match
 * bundles the other products that also qualify are listed.
 *
 * A kit is its own offer, one of each product, apart from the pack picker or
 * quantity above (as Amazon's "Frequently bought together" and Indian D2C
 * combos work): the panel says so, so "3 packs" above and "This product ₹499"
 * here don't read as a contradiction.
 *
 * The terms are stated where the price is: once per complete kit, not with
 * discount codes. Nothing is added unless the shopper presses the button.
 */
export function ProductCombos({ offers }: { offers: ComboOffer[] }) {
  if (offers.length === 0) return null;
  return (
    <section aria-labelledby="combos-h" className="panel mt-5">
      <h2 id="combos-h" className="panel-head">
        Or buy as a kit
      </h2>
      <div className="grid gap-5 p-3.5">
        <p className="text-small text-ink-soft">
          A kit is one of each product shown, at the kit price. It&rsquo;s added on its own; your choice above doesn&rsquo;t
          change.
        </p>
        {offers.map((offer) => (
          <Combo key={offer.bundleId} offer={offer} />
        ))}
        <p className="text-micro text-ink-faint">
          The kit price applies to each complete kit; extra units are at the usual price. Discount codes don&rsquo;t apply
          to kit items.
          {offers.length > 1 && " One offer per item: where a product is in more than one kit, the basket applies the one that saves you more."}
        </p>
      </div>
    </section>
  );
}

function Combo({ offer }: { offer: ComboOffer }) {
  const { addMany, pending } = useCart();
  const [added, setAdded] = useState(false);
  const percent = offer.salePaise > 0 ? Math.round((offer.savingPaise / offer.salePaise) * 100) : 0;
  // Owners often restate the rule ("Any two gummies, 12% off"); show only what adds to it.
  const note = offer.description && !offer.description.toLowerCase().includes(offer.discountLabel.toLowerCase()) ? offer.description : null;

  return (
    <div className="grid gap-3">
      <div>
        <p className="font-semibold">{offer.name}</p>
        <p className="text-micro text-ink-soft">
          {offer.kind === "fixed"
            ? `Buy these together: ${offer.discountLabel}.`
            : offer.maxItems === offer.minItems
              ? `Any ${offer.minItems} of the products below: ${offer.discountLabel}.`
              : `Any ${offer.minItems} or more of the products below: ${offer.discountLabel}.`}
          {note ? ` ${note}` : ""}
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
          <span className="block text-micro text-ink-faint">Kit price</span>
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
          {added ? "Added ✓" : `Add kit to basket · ${formatPriceTag(offer.comboPaise)}`}
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

    </div>
  );
}
