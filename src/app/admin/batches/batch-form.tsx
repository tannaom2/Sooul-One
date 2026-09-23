"use client";

import { useActionState } from "react";
import { addBatch, type ActionResult } from "../actions";

const INITIAL: ActionResult = { ok: false };

export function BatchForm({ products }: { products: { id: string; name: string }[] }) {
  const [state, submit, pending] = useActionState(addBatch, INITIAL);

  return (
    <form action={submit} className="panel grid gap-4 p-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="productId">Product</label>
        <select id="productId" name="productId" className="field">
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="batchNumber">Batch number</label>
        <input id="batchNumber" name="batchNumber" className="field" />
      </div>
      <div>
        <label className="label" htmlFor="quantityReceived">Quantity received</label>
        <input id="quantityReceived" name="quantityReceived" type="number" min={1} className="field tabular" />
      </div>
      <div>
        <label className="label" htmlFor="manufacturedOn">Manufactured on</label>
        <input id="manufacturedOn" name="manufacturedOn" type="date" className="field" />
      </div>
      <div>
        <label className="label" htmlFor="expiresOn">Best before</label>
        <input id="expiresOn" name="expiresOn" type="date" className="field" />
      </div>

      <div className="flex items-center gap-4 sm:col-span-2">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : "Receive batch"}
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
