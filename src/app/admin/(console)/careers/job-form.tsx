"use client";

import { useActionState } from "react";
import { keepFormValues } from "@/components/keep-form-values";
import { FieldError, FormStatus } from "../form-status";
import { deleteJob, saveJob, type FormResult } from "./actions";

const INITIAL: FormResult = { ok: false };

export interface JobValues {
  id: string | null;
  title: string;
  team: string | null;
  location: string;
  employmentType: string;
  summary: string;
  applyUrl: string | null;
  applyEmail: string | null;
  sortOrder: number;
  published: boolean;
}

export function JobForm({ values }: { values: JobValues }) {
  const [state, submit, pending] = useActionState(saveJob, INITIAL);
  const k = values.id ?? "new";
  const err = state.fieldErrors ?? {};
  const input = (name: keyof JobValues, label: string, extra: Record<string, unknown> = {}) => (
    <div>
      <label className="label" htmlFor={`${name}-${k}`}>
        {label}
      </label>
      <input
        id={`${name}-${k}`}
        name={name}
        defaultValue={(values[name] as string | number | null) ?? ""}
        className="field"
        aria-invalid={Boolean(err[name]) || undefined}
        aria-describedby={err[name] ? `${name}-${k}-error` : undefined}
        {...extra}
      />
      <FieldError id={`${name}-${k}`} message={err[name]} />
    </div>
  );
  return (
    <form onSubmit={keepFormValues(submit)} className="grid gap-4 sm:grid-cols-2">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {input("title", "Role", { required: true, maxLength: 120 })}
      {input("team", "Team (optional)", { maxLength: 80 })}
      {input("location", "Location", { required: true, maxLength: 120, placeholder: "Ahmedabad / Remote" })}
      {input("employmentType", "Type", { required: true, maxLength: 60, placeholder: "Full-time" })}
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`summary-${k}`}>
          About the role
        </label>
        <textarea id={`summary-${k}`} name="summary" defaultValue={values.summary} rows={5} maxLength={1500} required className="field" />
        <FieldError id={`summary-${k}`} message={err.summary} />
      </div>
      {input("applyUrl", "Apply link (optional)", { type: "url", placeholder: "https://…" })}
      {input("applyEmail", "Or apply by email", { type: "email", placeholder: "careers@sooulone.in" })}
      {input("sortOrder", "Order", { type: "number", min: 0, max: 999 })}
      <label className="flex items-center gap-2 self-end pb-3 text-small">
        <input type="checkbox" name="published" defaultChecked={values.published} /> Published
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : values.id ? "Save" : "Add role"}
        </button>
        {values.id && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              if (confirm("Delete this role?")) void deleteJob(values.id!);
            }}
          >
            Delete
          </button>
        )}
        <FormStatus state={state} />
      </div>
    </form>
  );
}
