"use client";

import { useActionState } from "react";
import { keepFormValues } from "@/components/keep-form-values";
import { FieldError, FormStatus } from "../form-status";
import { deleteAnnouncement, saveAnnouncement, type FormResult } from "./actions";

const INITIAL: FormResult = { ok: false };

export interface AnnouncementValues {
  id: string | null;
  text: string;
  href: string | null;
  enabled: boolean;
  sortOrder: number;
}

/** One top-bar message: edit in place, or add a new one (id null). */
export function AnnouncementForm({ values }: { values: AnnouncementValues }) {
  const [state, submit, pending] = useActionState(saveAnnouncement, INITIAL);
  const key = values.id ?? "new";
  return (
    <form onSubmit={keepFormValues(submit)} className="grid items-start gap-3 border-b border-rule p-4 last:border-b-0 md:grid-cols-[1fr_12rem_5rem_auto]">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div>
        <label className="label" htmlFor={`text-${key}`}>
          Message
        </label>
        <input
          id={`text-${key}`}
          name="text"
          defaultValue={values.text}
          maxLength={90}
          required
          className="field"
          aria-invalid={Boolean(state.fieldErrors?.text) || undefined}
          aria-describedby={state.fieldErrors?.text ? `text-${key}-error` : undefined}
        />
        <FieldError id={`text-${key}`} message={state.fieldErrors?.text} />
      </div>
      <div>
        <label className="label" htmlFor={`href-${key}`}>
          Link <span className="font-normal text-ink-soft">(optional)</span>
        </label>
        <input id={`href-${key}`} name="href" defaultValue={values.href ?? ""} placeholder="e.g. /help (leave empty for none)" className="field" />
        <FieldError id={`href-${key}`} message={state.fieldErrors?.href} />
      </div>
      <div>
        <label className="label" htmlFor={`order-${key}`}>
          Order
        </label>
        <input id={`order-${key}`} name="sortOrder" type="number" min={0} max={99} defaultValue={values.sortOrder} className="field tabular" />
      </div>
      <div className="grid gap-2 md:pt-6">
        <label className="flex items-center gap-2 text-small">
          <input type="checkbox" name="enabled" defaultChecked={values.enabled} /> Shown
        </label>
        <div className="flex gap-2">
          <button className="btn btn-solid" disabled={pending}>
            {pending ? "Saving…" : values.id ? "Save" : "Add"}
          </button>
          {values.id && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                if (confirm("Remove this message from the top bar?")) void deleteAnnouncement(values.id!);
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      <div className="md:col-span-4">
        <FormStatus state={state} />
      </div>
    </form>
  );
}
