"use client";

import { useActionState, useState } from "react";
import { saveBundle } from "./actions";
import type { ActionResult } from "../actions";
import { keepFormValues, useClearOnSuccess } from "@/components/keep-form-values";

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
 */
export function BundleForm({ brands, products }: { brands: Brand[]; products: Product[] }) {
  const [state, submit, pending] = useActionState(saveBundle, INITIAL);
  const formRef = useClearOnSuccess(state);
  const [brandId, setBrandId] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [fixed, setFixed] = useState(false);

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
          <select name="discountType" className="field" defaultValue="PERCENTAGE">
            <option value="PERCENTAGE">Percentage off</option>
            <option value="FLAT">Flat amount off</option>
          </select>
        </label>

        <label className="text-small">
          <span className="mb-1 block font-medium">Discount value</span>
          <input name="discountValue" type="number" step="0.01" min="0.01" className="field tabular" required />
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
              <input name="minItems" type="number" min="2" defaultValue={2} className="field tabular" />
            </label>

            <label className="text-small">
              <span className="mb-1 block font-medium">Most products per combo (optional)</span>
              <input name="maxItems" type="number" min="1" className="field tabular" />
            </label>
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
