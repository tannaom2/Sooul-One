"use client";

import { createContext, useContext, useState } from "react";
import { formatPriceTag } from "@/lib/money";
import { MAX_LINE_QUANTITY } from "@/lib/basket-types";
import { Price } from "@/components/ui";

/**
 * The one owner of "how many is the shopper buying" on a product page. The
 * headline price, the pack picker or stepper, the Add button and the phone's
 * sticky bar all read it, so they can't disagree (they used to: the price
 * stayed at one pack, and the sticky bar always added one).
 */
interface BuyQuantity {
  quantity: number;
  setQuantity: (n: number) => void;
  /** Most that can be added: what can ship, capped at the basket's per-line limit. */
  max: number;
}

const Ctx = createContext<BuyQuantity | null>(null);

export function BuyQuantityProvider({ max, children }: { max: number; children: React.ReactNode }) {
  const cap = Math.max(1, Math.min(MAX_LINE_QUANTITY, max));
  const [quantity, setRaw] = useState(1);
  const setQuantity = (n: number) => setRaw(Math.max(1, Math.min(cap, n)));
  return <Ctx.Provider value={{ quantity, setQuantity, max: cap }}>{children}</Ctx.Provider>;
}

/** Outside a provider (not expected), behaves as a single unit. */
export function useBuyQuantity(): BuyQuantity {
  return useContext(Ctx) ?? { quantity: 1, setQuantity: () => {}, max: MAX_LINE_QUANTITY };
}

/** The buy box's headline: the total for what's chosen, with the unit price under it once it's more than one. */
export function BuyBoxPrice({
  unitPaise,
  comparePaise,
  percentOff,
  unitName,
}: {
  unitPaise: number;
  comparePaise: number | null;
  percentOff: number | null;
  /** "pack" or "item", for "3 packs × ₹599". */
  unitName: string;
}) {
  const { quantity } = useBuyQuantity();
  return (
    <span className="grid">
      <Price
        pricePaise={unitPaise * quantity}
        comparePaise={comparePaise == null ? null : comparePaise * quantity}
        percentOff={percentOff}
      />
      {quantity > 1 && (
        <span className="tabular text-micro font-normal text-ink-faint" aria-live="polite">
          {quantity} {unitName}s × {formatPriceTag(unitPaise)}
        </span>
      )}
    </span>
  );
}
