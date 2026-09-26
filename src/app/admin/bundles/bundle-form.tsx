"use client";

import { useActionState, useState } from "react";
import { saveBundle } from "./actions";
import type { ActionResult } from "../actions";
import { keepFormValues, useClearOnSuccess } from "@/components/keep-form-values";
import { stepUpAddOnPercent } from "@/lib/validation/bundle";

const INITIAL: ActionResult = { ok: false };

interface Brand {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  brandId: string;
}

/**
 * Brand, the eligible products and the combo kind depend on each other, so
 * they're controlled state: picking a brand shows only its products (the
 * server refuses any other), and a fixed combo requires every chosen product.
 * The discount fields are controlled too, so the step-up can show the owner
 * what the extra product really costs before they save.
 */
export function BundleForm({ brands, products }: { brands: Brand[]; products: Product[] }) {
  const [state, submit, pending] = useActionState(saveBundle, INITIAL);
  const formRef = useClearOnSuccess(state);
  const [brandId, setBrandId] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [fixed, setFixed] = useState(false);
  const [discountType, setDiscountType] = useState("PERCENTAGE");
  const [discountValue, setDiscountValue] = useState("");
  const [minItems, setMinItems] = useState("2");
  const [stepUp, setStepUp] = useState("");
  const min = Math.max(2, Number(minItems) || 2);
  const base = Number(discountValue);
  const step = Number(stepUp);
  const hasStepUp = !fixed && stepUp !== "" && step > 0;

  const brandProducts = products.filter((p) => p.brandId === brandId);
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form
      ref={formRef}
      onSubmit={keepFormValues(submit)}
      onReset={() => {
        setBrandId("");
        setChosen(new Set());
        setFixed(false);
        setDiscountType("PERCENTAGE");
        setDiscountValue("");
        setMinItems("2");
        setStepUp("");
      }}
      className="panel grid gap-4 p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-small">
          <span className="mb-1 block font-medium">Bundle name</span>
          <input name="name" className="field" placeholder="Diwali Namkeen Hamper" required />
        </label>

        <label className="text-small">
          <span className="mb-1 block font-medium">Brand</span>
          <select
            name="brandId"
            className="field"
            required
            value={brandId}
            onChange={(e) => {
              setBrandId(e.target.value);
              // Products from the previous brand can't be in this bundle.
              setChosen(new Set());
            }}
          >
            <option value="" disabled>
              Choose a brand
            </option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-small sm:col-span-2">
          <span className="mb-1 block font-medium">Description (optional)</span>
          <input name="description" className="field" placeholder="Shown with the combo on product pages" />
        </label>

        <label className="text-small">
          <span className="mb-1 block font-medium">Discount type</span>
          <select name="discountType" className="field" value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
            <option value="PERCENTAGE">Percentage off</option>
            <option value="FLAT">Flat amount off</option>
          </select>
        </label>

        <label className="text-small">
          <span className="mb-1 block font-medium">Discount value</span>
          <input
            name="discountValue"
            type="number"
            step="0.01"
            min="0.01"
            className="field tabular"
            required
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
          />
        </label>

        <label className="flex items-start gap-3 text-small sm:col-span-2">
          <input type="checkbox" name="fixedCombo" className="mt-1" checked={fixed} onChange={(e) => setFixed(e.target.checked)} />
          <span>
            <span className="font-semibold">Fixed combo</span>
            <span className="block text-ink-soft">
              Every product you tick is required (e.g. &ldquo;Biotin Glow + Everyday Multivitamin&rdquo;). Leave unticked for
              mix-and-match: any number of them you choose below.
            </span>
          </span>
        </label>

        {!fixed && (
          <>
            <label className="text-small">
              <span className="mb-1 block font-medium">Products needed for the offer</span>
              <input name="minItems" type="number" min="2" className="field tabular" value={minItems} onChange={(e) => setMinItems(e.target.value)} />
            </label>

            {hasStepUp ? (
              <p className="self-end text-small text-ink-soft">
                Most products per combo: {min + 1}, set by the step-up below.
              </p>
            ) : (
              <label className="text-small">
                <span className="mb-1 block font-medium">Most products per combo (optional)</span>
                <input name="maxItems" type="number" min="1" className="field tabular" />
              </label>
            )}

            <div className="grid gap-1 text-small sm:col-span-2">
              <label>
                <span className="mb-1 block font-medium">
                  Discount with {min + 1} products (optional step-up, {discountType === "PERCENTAGE" ? "%" : "₹"})
                </span>
                <input
                  name="stepUpValue"
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="field tabular sm:w-48"
                  value={stepUp}
                  onChange={(e) => setStepUp(e.target.value)}
                />
              </label>
              <span className="text-ink-soft">
                &ldquo;Buy {min}, save {discountType === "PERCENTAGE" ? `${discountValue || "…"}%` : `₹${discountValue || "…"}`}; buy {min + 1}, save more.&rdquo; The basket
                suggests one more product to shoppers who have a {min}-product kit.
              </span>
              {hasStepUp && base > 0 && step > base && (
                <span className="border-l-4 border-caution bg-shelf px-3 py-2 text-ink">
                  {discountType === "PERCENTAGE" ? (
                    <>
                      With products of similar price, the extra product is in effect{" "}
                      <strong>{stepUpAddOnPercent(min, base, step)}% off</strong> ({min + 1} × {step}% − {min} × {base}%). You give
                      that up on each {min + 1}-product kit, in exchange for selling one more product.
                    </>
                  ) : (
                    <>
                      A {min + 1}-product kit gives away <strong>₹{(step - base).toFixed(2).replace(/.00$/, "")} more</strong> than a{" "}
                      {min}-product kit, in exchange for selling one more product.
                    </>
                  )}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 text-small font-medium">
          Products in this bundle{brandId && ` · ${chosen.size} chosen`}
        </legend>
        {brandId ? (
          <div className="grid max-h-64 gap-1.5 overflow-y-auto border border-rule p-3 sm:grid-cols-2">
            {brandProducts.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-small">
                <input type="checkbox" name="eligibleProductIds" value={p.id} checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />
                {p.name}
              </label>
            ))}
            {brandProducts.length === 0 && <p className="text-small text-ink-faint">This brand has no live products yet.</p>}
          </div>
        ) : (
          <p className="border border-dashed border-rule p-3 text-small text-ink-faint">Choose a brand to see its products.</p>
        )}
        <p className="mt-2 text-micro text-ink-faint">
          How it prices: the discount applies to one of each product per complete combo; extra units pay their normal price.
          A product already on sale gets whichever price is lower, never both, and discount codes don&rsquo;t apply on top.
        </p>
      </fieldset>

      <div className="flex items-center gap-4">
        <button className="btn btn-solid w-fit" disabled={pending}>
          {pending ? "Creating…" : "Create bundle"}
        </button>
        <div aria-live="polite" role="status">
          {state.message && (
            <p className="text-small" style={{ color: state.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
              {state.message}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
