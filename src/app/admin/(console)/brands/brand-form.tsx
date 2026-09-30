"use client";

import { useActionState, useState } from "react";
import { keepFormValues } from "@/components/keep-form-values";
import { SOCIAL_FIELDS } from "@/lib/validation/site-content";
import { FieldError, FormStatus } from "../form-status";
import { saveBrand, type FormResult } from "./actions";

const INITIAL: FormResult = { ok: false };

export interface BrandValues {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  domain: string | null;
  domainMode: "OFF" | "REDIRECT" | "STANDALONE";
  instagramUrl: string | null;
  facebookUrl: string | null;
  xUrl: string | null;
  youtubeUrl: string | null;
}

const MODES = {
  OFF: { label: "Not used", detail: "The brand lives at its page on the main site only." },
  REDIRECT: { label: "Send to the main site", detail: "Every visit to the domain goes to the brand's page on the main site (a permanent redirect, so search ranking moves over)." },
  STANDALONE: {
    label: "Its own site",
    detail: "The domain shows the brand's page as its home page, with the same products, basket and checkout. Search engines are told the brand domain is the main copy of the brand's pages.",
  },
} as const;

export function BrandForm({ values, mainPath }: { values: BrandValues; mainPath: string }) {
  const [state, submit, pending] = useActionState(saveBrand, INITIAL);
  const [mode, setMode] = useState(values.domainMode);
  const err = state.fieldErrors ?? {};
  const k = values.slug;
  return (
    <form onSubmit={keepFormValues(submit)} className="grid gap-5">
      <input type="hidden" name="id" value={values.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`tagline-${k}`}>
            Tagline
          </label>
          <input id={`tagline-${k}`} name="tagline" defaultValue={values.tagline ?? ""} maxLength={120} className="field" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`description-${k}`}>
            Description <span className="font-normal text-ink-soft">(the brand page introduction)</span>
          </label>
          <textarea id={`description-${k}`} name="description" defaultValue={values.description ?? ""} rows={2} maxLength={400} className="field" />
        </div>
      </div>

      <fieldset className="grid gap-3 border border-rule p-4">
        <legend className="label px-1">Own domain</legend>
        <div>
          <label className="label" htmlFor={`domain-${k}`}>
            Domain
          </label>
          <input
            id={`domain-${k}`}
            name="domain"
            defaultValue={values.domain ?? ""}
            placeholder="womanaxis.in"
            className="field max-w-sm"
            aria-invalid={Boolean(err.domain) || undefined}
            aria-describedby={err.domain ? `domain-${k}-error` : undefined}
          />
          <FieldError id={`domain-${k}`} message={err.domain} />
        </div>
        <div className="grid gap-2">
          {(Object.keys(MODES) as (keyof typeof MODES)[]).map((m) => (
            <label key={m} className={`flex cursor-pointer gap-3 border p-3 ${mode === m ? "border-ink" : "border-rule"}`}>
              <input type="radio" name="domainMode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1" />
              <span>
                <span className="block font-semibold">{MODES[m].label}</span>
                <span className="block text-small text-ink-soft">{MODES[m].detail}</span>
              </span>
            </label>
          ))}
        </div>
        {mode !== "OFF" && (
          <p className="text-micro text-ink-soft">
            Before switching on: point the domain at the site (DNS, then add it as a custom domain on Render), and for
            &ldquo;Its own site&rdquo; also add it to Razorpay&apos;s website list and Cloudflare Turnstile&apos;s hostnames. Steps: docs/BRANDS.md.
            The brand&apos;s page on the main site ({mainPath}) keeps working either way.
          </p>
        )}
      </fieldset>

      <fieldset className="grid gap-4 border border-rule p-4 sm:grid-cols-2">
        <legend className="label px-1">Social profiles</legend>
        {SOCIAL_FIELDS.map((f) => (
          <div key={f.name}>
            <label className="label" htmlFor={`${f.name}-${k}`}>
              {f.label}
            </label>
            <input
              id={`${f.name}-${k}`}
              name={f.name}
              defaultValue={values[f.name] ?? ""}
              placeholder={`https://www.${f.hosts[0]}/…`}
              className="field"
              aria-invalid={Boolean(err[f.name]) || undefined}
              aria-describedby={err[f.name] ? `${f.name}-${k}-error` : undefined}
            />
            <FieldError id={`${f.name}-${k}`} message={err[f.name]} />
          </div>
        ))}
      </fieldset>

      <div className="flex items-center gap-4">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : `Save ${values.name}`}
        </button>
        <FormStatus state={state} />
      </div>
    </form>
  );
}
