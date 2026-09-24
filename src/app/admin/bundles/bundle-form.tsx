"use client";

import { useActionState } from "react";
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

export function BundleForm({ brands, products }: { brands: Brand[]; products: Product[] }) {
  const [state, submit, pending] = useActionState(saveBundle, INITIAL);
  const formRef = useClearOnSuccess(state);

  return (
    <form ref={formRef} onSubmit={keepFormValues(submit)} className="panel grid gap-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-small">
          <span className="mb-1 block font-medium">Bundle name</span>
          <input name="name" className="field" placeholder="Diwali Namkeen Hamper" required />
        </label>

        <label className="text-small">
          <span className="mb-1 block font-medium">Brand</span>
          <select name="brandId" className="field" required defaultValue="">
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
          <input name="description" className="field" />
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

        <label className="text-small">
          <span className="mb-1 block font-medium">Minimum distinct products</span>
          <input name="minItems" type="number" min="2" defaultValue={2} className="field tabular" />
        </label>

        <label className="text-small">
          <span className="mb-1 block font-medium">Maximum discounted (optional)</span>
          <input name="maxItems" type="number" min="1" className="field tabular" />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-small font-medium">Eligible products</legend>
        <div className="grid max-h-64 gap-1.5 overflow-y-auto border border-[--color-rule] p-3 sm:grid-cols-2">
          {products.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-small">
              <input type="checkbox" name="eligibleProductIds" value={p.id} />
              {p.name}
            </label>
          ))}
        </div>
        <p className="mt-1 text-micro text-ink-faint">
          Pick at least two — the discount applies once the basket has that many distinct eligible
          products, not per pair.
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
