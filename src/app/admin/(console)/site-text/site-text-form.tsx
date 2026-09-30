"use client";

import { useActionState, useRef } from "react";
import { keepFormValues } from "@/components/keep-form-values";
import { SITE_TEXT, SITE_TEXT_KEYS, type SiteText } from "@/lib/site-content";
import { FieldError, FormStatus } from "../form-status";
import { saveSiteText, type FormResult } from "./actions";

const INITIAL: FormResult = { ok: false };
const GROUPS = [...new Set(SITE_TEXT_KEYS.map((k) => SITE_TEXT[k].group))];

export function SiteTextForm({ values }: { values: SiteText }) {
  const [state, submit, pending] = useActionState(saveSiteText, INITIAL);
  const form = useRef<HTMLFormElement>(null);

  const reset = (key: keyof SiteText) => {
    const el = form.current?.elements.namedItem(key) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) el.value = SITE_TEXT[key].default;
  };

  return (
    <form ref={form} onSubmit={keepFormValues(submit)} className="grid gap-6">
      {GROUPS.map((group) => (
        <fieldset key={group} className="panel grid gap-4 p-4">
          <legend className="label px-1">{group}</legend>
          {SITE_TEXT_KEYS.filter((k) => SITE_TEXT[k].group === group).map((k) => {
            const f = SITE_TEXT[k];
            const custom = values[k] !== f.default;
            const err = state.fieldErrors?.[k];
            const common = {
              id: k,
              name: k,
              defaultValue: values[k],
              maxLength: f.max,
              className: "field",
              "aria-invalid": Boolean(err) || undefined,
              "aria-describedby": [err ? `${k}-error` : null, `${k}-hint`].filter(Boolean).join(" "),
            };
            return (
              <div key={k}>
                <div className="flex items-baseline justify-between gap-3">
                  <label className="label" htmlFor={k}>
                    {f.label}
                  </label>
                  {custom && (
                    <button type="button" className="text-micro underline underline-offset-2" onClick={() => reset(k)}>
                      Use the default
                    </button>
                  )}
                </div>
                {"multiline" in f && f.multiline ? <textarea rows={3} {...common} /> : <input {...common} />}
                <p id={`${k}-hint`} className="mt-1 text-micro text-ink-faint">
                  {"hint" in f ? `${f.hint} ` : ""}Leave empty to hide it.
                </p>
                <FieldError id={k} message={err} />
              </div>
            );
          })}
        </fieldset>
      ))}
      <div className="flex items-center gap-4">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : "Save site text"}
        </button>
        <FormStatus state={state} />
      </div>
    </form>
  );
}
