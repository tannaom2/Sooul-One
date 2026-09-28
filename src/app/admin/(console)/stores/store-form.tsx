"use client";

import { useActionState } from "react";
import { saveStore, type ActionResult } from "../actions";
import { keepFormValues, useClearOnSuccess } from "@/components/keep-form-values";

const INITIAL: ActionResult = { ok: false };

const FIELDS: readonly [name: string, label: string][] = [
  ["name", "Store name"],
  ["addressLine1", "Address"],
  ["addressLine2", "Area or landmark"],
  ["city", "City"],
  ["state", "State"],
  ["postalCode", "Pincode"],
  ["phone", "Phone"],
  ["openingHours", "Opening hours"],
  ["latitude", "Latitude"],
  ["longitude", "Longitude"],
];

/** Adds a store, or edits one when `store` is given. */
export function StoreForm({ store }: { store?: Record<string, unknown> & { id: string; isActive: boolean } }) {
  const [state, submit, pending] = useActionState(saveStore, INITIAL);
  const clearRef = useClearOnSuccess(state);
  // Only a new-store form clears after saving; an edit keeps what was saved.
  const formRef = store ? undefined : clearRef;

  return (
    <form ref={formRef} onSubmit={keepFormValues(submit)} className="panel grid gap-4 p-4 sm:grid-cols-2">
      {store && <input type="hidden" name="id" value={store.id} />}
      {FIELDS.map(([name, label]) => (
        <label key={name} className="text-small">
          <span className="mb-1 block font-medium">{label}</span>
          <input name={name} className="field" defaultValue={store?.[name] == null ? "" : String(store[name])} />
        </label>
      ))}

      {store && (
        <label className="flex items-start gap-3 text-small sm:col-span-2">
          <input type="checkbox" name="isActive" className="mt-1" defaultChecked={store.isActive} />
          <span>
            <span className="font-semibold">Open, and shown on the site</span>
            <span className="block text-ink-soft">Untick when a store closes: it leaves the store finder but its history stays.</span>
          </span>
        </label>
      )}

      <div className="flex items-center gap-4 sm:col-span-2">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : store ? "Save store" : "Add store"}
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
