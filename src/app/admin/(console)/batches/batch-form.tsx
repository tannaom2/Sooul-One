"use client";

import { useActionState } from "react";
import { addBatch, type ActionResult } from "../actions";
import { keepFormValues, useClearOnSuccess } from "@/components/keep-form-values";

const INITIAL: ActionResult = { ok: false };

export function BatchForm({
  products,
  suppliers,
  today,
}: {
  /** Each product with its manufacturer, which the supplier choice starts at. */
  products: { id: string; name: string; manufacturerId: string | null }[];
  suppliers: { id: string; name: string }[];
  /** yyyy-mm-dd, India time: received today unless changed. */
  today: string;
}) {
  const [state, submit, pending] = useActionState(addBatch, INITIAL);
  const formRef = useClearOnSuccess(state);

  return (
    <form ref={formRef} onSubmit={keepFormValues(submit)} className="panel grid gap-4 p-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="productId">Product</label>
        <select id="productId" name="productId" className="field" onChange={(e) => {
          // Start the supplier at the product's manufacturer: the usual case.
          const maker = products.find((p) => p.id === e.target.value)?.manufacturerId;
          const select = e.currentTarget.form?.elements.namedItem("supplierId") as HTMLSelectElement | null;
          if (select && maker) select.value = maker;
        }}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Where it came from, for tracing a recall back to its source (Suppliers). */}
      <div>
        <label className="label" htmlFor="supplierId">Supplied by</label>
        <select id="supplierId" name="supplierId" className="field" defaultValue={products[0]?.manufacturerId ?? ""}>
          <option value="">Choose the supplier</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <p className="mt-1 text-micro text-ink-faint">
          Not listed? Add it under <a href="/admin/suppliers" className="underline">Suppliers</a> first.
        </p>
      </div>
      <div>
        <label className="label" htmlFor="receivedOn">Received on</label>
        <input id="receivedOn" name="receivedOn" type="date" className="field" defaultValue={today} max={today} />
      </div>
      <div>
        <label className="label" htmlFor="invoiceNumber">Supplier&apos;s invoice number</label>
        <input id="invoiceNumber" name="invoiceNumber" className="field" maxLength={60} />
      </div>
      <div>
        <label className="label" htmlFor="invoiceDate">Invoice date</label>
        <input id="invoiceDate" name="invoiceDate" type="date" className="field" max={today} />
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
