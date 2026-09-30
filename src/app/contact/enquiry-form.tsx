"use client";

import { useActionState, useState } from "react";
import { Turnstile } from "@/components/turnstile";
import { keepFormValues } from "@/components/keep-form-values";
import { ENQUIRY_KINDS } from "@/lib/validation/site-content";
import { sendEnquiry, type EnquiryState } from "./actions";

const INITIAL: EnquiryState = {};

export function EnquiryForm({ initialKind, turnstileSiteKey }: { initialKind: keyof typeof ENQUIRY_KINDS; turnstileSiteKey: string | null }) {
  const [kind, setKind] = useState(initialKind);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [state, submit, pending] = useActionState(async (prev: EnquiryState, form: FormData) => {
    const result = await sendEnquiry(prev, form);
    setResetKey((n) => n + 1);
    return result;
  }, INITIAL);

  if (state.ok) {
    return (
      <p role="status" className="panel p-5 font-semibold text-veg">
        {state.message}
      </p>
    );
  }

  const err = (name: string) =>
    state.fieldErrors?.[name] ? (
      <p id={`${name}-error`} className="mt-1 text-micro text-alert">
        {state.fieldErrors[name]}
      </p>
    ) : null;
  const aria = (name: string) => (state.fieldErrors?.[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {});

  return (
    <form onSubmit={keepFormValues(submit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <fieldset className="sm:col-span-2">
        <legend className="label">What&apos;s it about?</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ENQUIRY_KINDS) as (keyof typeof ENQUIRY_KINDS)[]).map((k) => (
            <label key={k} className={`flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-small ${kind === k ? "border-ink font-semibold" : "border-rule"}`}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              {ENQUIRY_KINDS[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="enq-name">
          Your name
        </label>
        <input id="enq-name" name="name" autoComplete="name" required maxLength={100} className="field" {...aria("name")} />
        {err("name")}
      </div>
      <div>
        <label className="label" htmlFor="enq-email">
          Email
        </label>
        <input id="enq-email" name="email" type="email" autoComplete="email" required maxLength={200} className="field" {...aria("email")} />
        {err("email")}
      </div>
      <div>
        <label className="label" htmlFor="enq-phone">
          Phone <span className="font-normal text-ink-soft">(optional)</span>
        </label>
        <input id="enq-phone" name="phone" type="tel" autoComplete="tel" maxLength={20} className="field" {...aria("phone")} />
        {err("phone")}
      </div>
      {kind === "INTERNATIONAL" ? (
        <div>
          <label className="label" htmlFor="enq-country">
            Country to deliver to
          </label>
          <input id="enq-country" name="country" autoComplete="country-name" required maxLength={80} className="field" {...aria("country")} />
          {err("country")}
        </div>
      ) : (
        <div>
          <label className="label" htmlFor="enq-org">
            Company or channel <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <input id="enq-org" name="organisation" autoComplete="organization" maxLength={120} className="field" />
        </div>
      )}
      <div className="sm:col-span-2">
        <label className="label" htmlFor="enq-message">
          Message
        </label>
        <textarea id="enq-message" name="message" rows={5} required maxLength={2000} className="field" {...aria("message")} />
        {err("message")}
      </div>
      {/* Left empty by people; scripts fill in every field. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="enq-website">Website</label>
        <input id="enq-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="sm:col-span-2">
        <Turnstile siteKey={turnstileSiteKey} action="enquiry" onToken={setToken} resetKey={resetKey} />
      </div>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <button className="btn btn-solid" disabled={pending || (Boolean(turnstileSiteKey) && !token)}>
          {pending ? "Sending…" : "Send message"}
        </button>
        <p role="status" aria-live="polite" className="text-small text-alert">
          {state.message}
        </p>
      </div>
    </form>
  );
}
