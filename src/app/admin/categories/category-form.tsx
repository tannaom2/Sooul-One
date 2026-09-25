"use client";

import { useActionState } from "react";
import { saveCategory, type CategoryResult } from "./actions";
import { keepFormValues, useClearOnSuccess } from "@/components/keep-form-values";

const INITIAL: CategoryResult = { ok: false };

interface EditableCategory {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

/** Adds a category (choose the brand), or edits one when `category` is given. */
export function CategoryForm({
  brands,
  category,
}: {
  brands?: { id: string; name: string }[];
  category?: EditableCategory;
}) {
  const [state, submit, pending] = useActionState(saveCategory, INITIAL);
  const clearRef = useClearOnSuccess(state);

  return (
    <form ref={category ? undefined : clearRef} onSubmit={keepFormValues(submit)} className="panel grid gap-4 p-4 sm:grid-cols-2">
      {category ? (
        <input type="hidden" name="id" value={category.id} />
      ) : (
        <label className="text-small">
          <span className="mb-1 block font-medium">Brand</span>
          <select name="brandId" className="field" defaultValue="" required>
            <option value="" disabled>
              Choose a brand
            </option>
            {brands?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="text-small">
        <span className="mb-1 block font-medium">Name</span>
        <input name="name" className="field" defaultValue={category?.name ?? ""} maxLength={60} required />
        <span className="mt-1 block text-micro text-ink-faint">The need, not a cure: &ldquo;Hair Fall&rdquo;, not &ldquo;Cures hair loss&rdquo;.</span>
      </label>

      <label className="text-small sm:col-span-2">
        <span className="mb-1 block font-medium">Description (optional)</span>
        <textarea name="description" className="field" rows={2} maxLength={500} defaultValue={category?.description ?? ""} />
      </label>

      <label className="text-small">
        <span className="mb-1 block font-medium">Position</span>
        <input name="sortOrder" type="number" min={0} max={999} step={1} className="field" defaultValue={category?.sortOrder ?? 0} />
        <span className="mt-1 block text-micro text-ink-faint">Lower numbers show first in the brand&rsquo;s filters.</span>
      </label>

      {category && (
        <label className="flex items-start gap-3 text-small sm:col-span-2">
          <input type="checkbox" name="isActive" className="mt-1" defaultChecked={category.isActive} />
          <span>
            <span className="font-semibold">On sale</span>
            <span className="block text-ink-soft">
              Untick to take the category and its {category.productCount} product{category.productCount === 1 ? "" : "s"} off the
              shop. They also can&rsquo;t be bought from baskets that already hold them.
            </span>
          </span>
        </label>
      )}

      <div className="flex items-center gap-4 sm:col-span-2">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : category ? "Save category" : "Add category"}
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
