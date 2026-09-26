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
 * kits, so the shopper never has to line quantities up by hand, and each
 * product can be taken out of the kits on its own (the kits regroup around
 * what's left). Units outside the kits stay on their own lines, at the usual
 * price.
 *
 * When mix-and-match kits hold different products, "− kit" removes the last
 * kit formed (one of each of its products) and "+ kit" adds another like it,
 * so the count always moves by exactly one.
 */
export function KitBlock({ kit, refreshPage = false }: { kit: BasketKit; refreshPage?: boolean }) {
  const { setQuantities, add, pending: cartPending } = useCart();
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

  const removeKits = () => apply(kit.members.map((m) => ({ itemId: m.itemId, quantity: m.quantity - m.units })));
  const lastSet = kit.members.filter((m) => kit.lastSet.includes(m.productId));
  const setKits = (next: number) => {
    const delta = next - kit.sets;
    if (next <= 0) removeKits();
    else if (delta !== 0) apply(lastSet.map((m) => ({ itemId: m.itemId, quantity: m.quantity + delta })));
  };
  const removeProduct = (m: BasketKit["members"][number]) => apply([{ itemId: m.itemId, quantity: m.quantity - m.units }]);
  const completeKit = () =>
    apply(
      kit.members
        .filter((m) => kit.completeWith.some((c) => c.productId === m.productId))
        .map((m) => ({ itemId: m.itemId, quantity: m.quantity + 1 })),
    );

  const addToKit = (productId: string) =>
    startTransition(async () => {
      await add(productId, 1, { open: false });
      if (refreshPage) router.refresh();
    });

  // One prompt per kit: completing another kit, or growing one, whichever saves more.
  const bestGrow = kit.growWith[0]?.savingPaise ?? 0;
  const showComplete = kit.completeWith.length > 0 && kit.nextKitSavingPaise >= bestGrow;
  const showGrow = !showComplete && kit.growWith.length > 0;

  const maxKits = kit.sets + Math.min(...lastSet.map((m) => MAX_LINE_QUANTITY - m.quantity));
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

      <ul className="mt-2 grid text-small text-ink-soft">
        {kit.members.map((m) => (
          <li key={m.productId} className="flex items-center justify-between gap-3">
            <span className="min-w-0">{m.name}</span>
            <span className="flex shrink-0 items-center gap-1">
              <span className="tabular text-ink-faint">{kit.uniform ? (kit.sets > 1 ? "1 per kit" : "1") : `× ${m.units}`}</span>
              <button
                type="button"
                onClick={() => removeProduct(m)}
                disabled={pending}
                aria-label={`Take ${m.name} out of the ${kitWord}`}
                title="Take out of the kit"
                className="grid h-8 w-8 place-items-center text-ink-faint hover:text-alert"
              >
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <QuantityStepper value={kit.sets} min={0} max={maxKits} label={kit.name} onChange={setKits} disabled={pending} />
          <span className="text-small text-ink-soft">{kitWord}</span>
          <button type="button" onClick={removeKits} disabled={pending} className="text-micro underline hover:text-alert">
            Remove {kitWord}
          </button>
        </span>
        <span className="text-small font-semibold text-veg">You save {formatPriceTag(kit.savingPaise)}</span>
      </div>

      {showGrow && (
        <div className="mt-3 border-t border-rule pt-3 text-small">
          <p className="font-semibold">{kit.growLabel}</p>
          <ul className="mt-1 grid gap-1.5">
            {kit.growWith.map((g) => (
              <li key={g.productId} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  {g.name} <span className="tabular text-ink-faint">{formatPriceTag(g.pricePaise)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-micro font-semibold text-veg">save {formatPriceTag(g.savingPaise)} more</span>
                  <button type="button" onClick={() => addToKit(g.productId)} disabled={pending} className="btn btn-outline px-3 py-1 text-micro">
                    Add
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showComplete && (
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
