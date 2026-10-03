"use client";

import { useActionState } from "react";
import { keepFormValues, useClearOnSuccess } from "@/components/keep-form-values";
import { LICENCE_TYPES } from "@/lib/suppliers";
import { saveSupplierAction, type SupplierResult } from "./actions";

const INITIAL: SupplierResult = { ok: false };
/** An edit form keeps its values after saving; only the add form clears. */
const KEEP = { ok: false };

export interface SupplierValues {
  id: string;
  name: string;
  address: string;
  fssaiLicence: string | null;
  licenceType: keyof typeof LICENCE_TYPES | null;
  /** yyyy-mm-dd */
  licenceExpiresOn: string | null;
  gstin: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  notes: string | null;
  isActive: boolean;
}

/** Add a supplier (no values) or edit one. */
export function SupplierForm({ values }: { values?: SupplierValues }) {
  const [state, submit, pending] = useActionState(saveSupplierAction, INITIAL);
  const formRef = useClearOnSuccess(values ? KEEP : state);
  const err = (k: string) => state.fieldErrors?.[k];
  const field = (name: keyof SupplierValues, label: string, opts: { type?: string; hint?: string; optional?: boolean; wide?: boolean; inputMode?: "numeric" | "email" | "tel" } = {}) => (
    <div className={opts.wide ? "sm:col-span-2" : undefined}>
      <label className="label" htmlFor={`${name}-${values?.id ?? "new"}`}>
        {label}
        {opts.optional && <span className="ml-1 font-normal text-ink-faint">(optional)</span>}
      </label>
      <input
        id={`${name}-${values?.id ?? "new"}`}
        name={name}
        type={opts.type ?? "text"}
        inputMode={opts.inputMode}
        className="field"
        defaultValue={(values?.[name] as string | null) ?? ""}
        aria-invalid={Boolean(err(name)) || undefined}
      />
      {err(name) ? <p className="mt-1 text-micro text-alert">{err(name)}</p> : opts.hint ? <p className="mt-1 text-micro text-ink-faint">{opts.hint}</p> : null}
    </div>
  );

  return (
    <form ref={formRef} onSubmit={keepFormValues(submit)} className="grid gap-4 sm:grid-cols-2">
      {values && <input type="hidden" name="id" value={values.id} />}
      {field("name", "Firm's name", { hint: "As on its FSSAI licence." })}
      {field("fssaiLicence", "FSSAI licence or registration number", { inputMode: "numeric", hint: "14 digits. Shown on the page of every product this firm makes or packs." })}
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`address-${values?.id ?? "new"}`}>
          Address
        </label>
        <textarea id={`address-${values?.id ?? "new"}`} name="address" rows={2} className="field" defaultValue={values?.address ?? ""} aria-invalid={Boolean(err("address")) || undefined} />
        {err("address") && <p className="mt-1 text-micro text-alert">{err("address")}</p>}
      </div>
      <div>
        <label className="label" htmlFor={`licenceType-${values?.id ?? "new"}`}>
          Kind of licence
        </label>
        <select id={`licenceType-${values?.id ?? "new"}`} name="licenceType" className="field" defaultValue={values?.licenceType ?? ""}>
          <option value="">Not entered</option>
          {Object.entries(LICENCE_TYPES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {err("licenceType") && <p className="mt-1 text-micro text-alert">{err("licenceType")}</p>}
      </div>
      {field("licenceExpiresOn", "Licence expires on", { type: "date", hint: "You're emailed 60 and 14 days before." })}
      {field("gstin", "GSTIN", { optional: true })}
      {field("contactName", "Contact person", { optional: true })}
      {field("contactPhone", "Phone", { optional: true, inputMode: "tel" })}
      {field("contactEmail", "Email", { optional: true, type: "email" })}
      {field("notes", "Notes", { optional: true, wide: true })}
      {values && (
        <label className="flex items-start gap-3 text-small sm:col-span-2">
          <input type="checkbox" name="isActive" className="mt-1" defaultChecked={values.isActive} />
          <span>
            <span className="font-semibold">Still bought from</span>
            <span className="block text-ink-soft">Untick to stop picking this firm for new products and batches. Its records stay.</span>
            {err("isActive") && <span className="mt-1 block text-micro text-alert">{err("isActive")}</span>}
          </span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : values ? "Save" : "Add supplier"}
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
