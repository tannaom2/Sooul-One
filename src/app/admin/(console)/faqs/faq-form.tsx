"use client";

import { useActionState } from "react";
import { keepFormValues } from "@/components/keep-form-values";
import { FAQ_TOPICS } from "@/lib/site-content";
import { FieldError, FormStatus } from "../form-status";
import { deleteFaq, saveFaq, type FormResult } from "./actions";

const INITIAL: FormResult = { ok: false };

export interface FaqValues {
  id: string | null;
  question: string;
  answer: string;
  topic: string;
  brandId: string | null;
  sortOrder: number;
  published: boolean;
}

export function FaqForm({ values, brands }: { values: FaqValues; brands: { id: string; name: string }[] }) {
  const [state, submit, pending] = useActionState(saveFaq, INITIAL);
  const k = values.id ?? "new";
  const err = state.fieldErrors ?? {};
  const aria = (name: string) => (err[name] ? { "aria-invalid": true, "aria-describedby": `${name}-${k}-error` } : {});
  return (
    <form onSubmit={keepFormValues(submit)} className="grid gap-4 sm:grid-cols-2">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`question-${k}`}>
          Question
        </label>
        <input id={`question-${k}`} name="question" defaultValue={values.question} maxLength={200} required className="field" {...aria("question")} />
        <FieldError id={`question-${k}`} message={err.question} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`answer-${k}`}>
          Answer
        </label>
        <textarea id={`answer-${k}`} name="answer" defaultValue={values.answer} rows={5} maxLength={2000} required className="field" {...aria("answer")} />
        <p className="mt-1 text-micro text-ink-faint">Plain text. {"{freeDelivery}"}, {"{deliveryFee}"} and {"{area}"} fill in from your settings.</p>
        <FieldError id={`answer-${k}`} message={err.answer} />
      </div>
      <div>
        <label className="label" htmlFor={`topic-${k}`}>
          Topic
        </label>
        <select id={`topic-${k}`} name="topic" defaultValue={values.topic} className="field">
          {Object.entries(FAQ_TOPICS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`brand-${k}`}>
          About
        </label>
        <select id={`brand-${k}`} name="brandId" defaultValue={values.brandId ?? ""} className="field">
          <option value="">Every brand</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} only
            </option>
          ))}
        </select>
        <FieldError id={`brand-${k}`} message={err.brandId} />
      </div>
      <div>
        <label className="label" htmlFor={`order-${k}`}>
          Order in its topic
        </label>
        <input id={`order-${k}`} name="sortOrder" type="number" min={0} max={999} defaultValue={values.sortOrder} className="field tabular" />
      </div>
      <label className="flex items-center gap-2 self-end pb-3 text-small">
        <input type="checkbox" name="published" defaultChecked={values.published} /> Published (shoppers see it)
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : values.id ? "Save" : "Add question"}
        </button>
        {values.id && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              if (confirm("Delete this question?")) void deleteFaq(values.id!);
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
