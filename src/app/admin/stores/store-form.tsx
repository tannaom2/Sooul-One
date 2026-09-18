"use client";

import { useActionState } from "react";
import { saveStore, type ActionResult } from "../actions";

const INITIAL: ActionResult = { ok: false };

export function StoreForm() {
  const [state, submit, pending] = useActionState(saveStore, INITIAL);

  return (
    <form action={submit} className="panel grid gap-4 p-4 sm:grid-cols-2">
      {[
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
      ].map(([name, label]) => (
        <label key={name} className="text-small">
          <span className="mb-1 block font-medium">{label}</span>
          <input name={name} className="field" />
        </label>
      ))}

      <div className="flex items-center gap-4 sm:col-span-2">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : "Add store"}
        </button>
        {state.message && (
          <p className="text-small" style={{ color: state.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
