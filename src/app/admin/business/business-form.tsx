"use client";

import { useActionState } from "react";
import { keepFormValues } from "@/components/keep-form-values";
import { BUSINESS_FIELDS } from "@/lib/validation/business";
import { saveBusinessProfile, type BusinessResult } from "./actions";

const INITIAL: BusinessResult = { ok: false };
const GROUPS = [...new Set(BUSINESS_FIELDS.map((f) => f.group))];

export function BusinessForm({ values }: { values: Record<string, string | null> }) {
  const [state, submit, pending] = useActionState(saveBusinessProfile, INITIAL);

  return (
    <form onSubmit={keepFormValues(submit)} className="grid gap-6">
      {GROUPS.map((group) => (
        <fieldset key={group} className="panel grid gap-4 p-4 sm:grid-cols-2">
          <legend className="label px-1">{group}</legend>
          {BUSINESS_FIELDS.filter((f) => f.group === group).map((f) => (
            <div key={f.name} className={f.name === "registeredAddress" ? "sm:col-span-2" : undefined}>
              <label className="label" htmlFor={f.name}>
                {f.label}
              </label>
              {f.name === "registeredAddress" ? (
                <textarea id={f.name} name={f.name} rows={2} className="field" defaultValue={values[f.name] ?? ""} />
              ) : (
                <input id={f.name} name={f.name} className="field" defaultValue={values[f.name] ?? ""} />
              )}
              {f.hint && <p className="mt-1 text-micro text-ink-faint">{f.hint}</p>}
              {state.fieldErrors?.[f.name] && <p className="mt-1 text-micro text-alert">{state.fieldErrors[f.name]}</p>}
            </div>
          ))}
        </fieldset>
      ))}

      <div className="flex items-center gap-4">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
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
