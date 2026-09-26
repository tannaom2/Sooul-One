"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPriceTag } from "@/lib/money";
import { MAX_LINE_QUANTITY, type BasketKit } from "@/lib/basket-types";
import { useCart } from "./cart-provider";
import { QuantityStepper } from "./quantity-stepper";

/**
 * A combo in the basket, shown as kits: "Growing-Up Kit × 2, ₹1,670, you save
 * ₹226", with the products listed under it. The stepper adds or removes whole
 * kits (one of each product), so the shopper never has to line quantities up
 * by hand. Units outside the kits stay on their own lines, at the usual price.
 *
 * Mix-and-match kits whose sets hold different products get no stepper (there
 * is no single "one more kit"); their products are changed on their own lines.
 */
export function KitBlock({ kit, refreshPage = false }: { kit: BasketKit; refreshPage?: boolean }) {
  const { setQuantities, pending: cartPending } = useCart();
  const [refreshing, startTransition] = useTransition();
  const router = useRouter();
  const pending = cartPending || refreshing;

  function apply(changes: { itemId: string; quantity: number }[]) {
    startTransition(async () => {
      await setQuantities(changes.map((c) => ({ ...c, quantity: Math.max(0, Math.min(MAX_LINE_QUANTITY, c.quantity)) })));
      // The full basket page is server-rendered from the same basket; re-render it.
      if (refreshPage) router.refresh();
    });
  }

  const setKits = (next: number) => {
    const delta = next - kit.sets;
    if (delta !== 0) apply(kit.members.map((m) => ({ itemId: m.itemId, quantity: m.quantity + delta })));
  };
  const removeKits = () => apply(kit.members.map((m) => ({ itemId: m.itemId, quantity: m.quantity - m.units })));
  const completeKit = () =>
    apply(
      kit.members
        .filter((m) => kit.completeWith.some((c) => c.productId === m.productId))
        .map((m) => ({ itemId: m.itemId, quantity: m.quantity + 1 })),
    );

  const maxKits = kit.sets + Math.min(...kit.members.map((m) => MAX_LINE_QUANTITY - m.quantity));
  const kitWord = kit.sets === 1 ? "kit" : "kits";

  return (
    <div className="border border-rule bg-shelf p-3.5" style={{ borderRadius: "var(--radius-panel)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-micro font-semibold tracking-wide text-veg uppercase">Combo</p>
          <p className="font-semibold">{kit.name}</p>
        </div>
        <p className="tabular shrink-0 text-right text-small">
          <span className="block font-semibold">{formatPriceTag(kit.kitPaise)}</span>
          <s className="text-micro text-ink-faint">{formatPriceTag(kit.salePaise)}</s>
        </p>
      </div>

      <ul className="mt-2 grid gap-0.5 text-small text-ink-soft">
        {kit.members.map((m) => (
          <li key={m.productId} className="flex justify-between gap-3">
            <span className="min-w-0">{m.name}</span>
            <span className="tabular shrink-0 text-ink-faint">{kit.uniform ? `${kit.sets > 1 ? "1 per kit" : "1"}` : `× ${m.units}`}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          {kit.uniform ? (
            <>
              <QuantityStepper value={kit.sets} min={0} max={maxKits} label={kit.name} onChange={setKits} disabled={pending} />
              <span className="text-small text-ink-soft">{kitWord}</span>
            </>
          ) : (
            <span className="text-small text-ink-soft">
              {kit.sets} {kitWord}
            </span>
          )}
          <button type="button" onClick={removeKits} disabled={pending} className="text-micro underline hover:text-alert">
            Remove {kitWord}
          </button>
        </span>
        <span className="text-small font-semibold text-veg">You save {formatPriceTag(kit.savingPaise)}</span>
      </div>

      {kit.completeWith.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-rule pt-3 text-small">
          <span>
            Add {kit.completeWith.map((c) => c.name).join(" + ")} to make another kit and save{" "}
            {formatPriceTag(kit.nextKitSavingPaise)}
          </span>
          <button type="button" onClick={completeKit} disabled={pending} className="btn btn-outline shrink-0 px-3 py-1 text-micro">
            Add
          </button>
        </div>
      )}
    </div>
  );
}
