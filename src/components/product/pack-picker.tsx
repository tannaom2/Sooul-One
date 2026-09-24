"use client";

import { formatINR, formatPriceTag } from "@/lib/money";

/**
 * 1 / 2 / 3 packs for supplements, with servings and the price per serving.
 *
 * Supplements are taken over weeks, so choosing the length of a course is
 * the natural question. No saving is shown because none exists: the offer
 * engine can't discount several units of one product (bundles need distinct
 * products). One pack is always the default; nothing is preselected upward.
 */
export function PackPicker({
  value,
  onChange,
  servingsPerPack,
  pricePaise,
}: {
  value: number;
  onChange: (packs: number) => void;
  servingsPerPack: number;
  pricePaise: number;
}) {
  const perServing = servingsPerPack > 0 ? pricePaise / servingsPerPack : null;
  return (
    <fieldset>
      <legend className="mb-2 text-small font-semibold">How many packs?</legend>
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3].map((packs) => {
          const active = packs === value;
          return (
            <label
              key={packs}
              // The radio is visually hidden, so the card shows its keyboard focus.
              className={`cursor-pointer border px-2 py-2.5 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${active ? "border-ink bg-shelf" : "border-[--color-rule]"}`}
              style={{ borderRadius: "var(--radius-panel)" }}
            >
              <input type="radio" name="packs" value={packs} checked={active} onChange={() => onChange(packs)} className="sr-only" />
              <span className="block text-small font-semibold">
                {packs} {packs === 1 ? "pack" : "packs"}
              </span>
              <span className="block text-micro text-ink-faint">{servingsPerPack * packs} servings</span>
              <span className="tabular mt-1 block text-small">{formatPriceTag(pricePaise * packs)}</span>
            </label>
          );
        })}
      </div>
      {perServing !== null && (
        <p className="mt-2 text-micro text-ink-faint">{formatINR(Math.round(perServing))} per serving, whichever you choose.</p>
      )}
    </fieldset>
  );
}
