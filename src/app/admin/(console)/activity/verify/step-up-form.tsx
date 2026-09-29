"use client";

import { useActionState, useState } from "react";
import { Turnstile } from "@/components/turnstile";
import { verifyStepUp, type StepUpState } from "../actions";

const INITIAL: StepUpState = {};

export function StepUpForm({ turnstileSiteKey, next = "/admin/activity" }: { turnstileSiteKey: string | null; next?: string }) {
  const [token, setToken] = useState<string | null>(null);
  // A token works once: after every try, the widget fetches a fresh one.
  const [resetKey, setResetKey] = useState(0);
  const [state, submit, pending] = useActionState(async (prev: StepUpState, form: FormData) => {
    const result = await verifyStepUp(prev, form);
    setResetKey((n) => n + 1);
    return result;
  }, INITIAL);
  return (
    <form action={submit} className="grid max-w-sm gap-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="code">
          Code from your authenticator app
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          className="field tabular tracking-widest"
          aria-invalid={Boolean(state.error) || undefined}
          aria-describedby={state.error ? "step-up-error" : undefined}
        />
      </div>
      {/* The widget puts its token in a hidden cf-turnstile-response field, sent with the form. */}
      <Turnstile siteKey={turnstileSiteKey} action="audit-step-up" onToken={setToken} resetKey={resetKey} />
      <button className="btn btn-solid justify-self-start" disabled={pending || (Boolean(turnstileSiteKey) && !token)}>
        {pending ? "Checking…" : "Open activity log"}
      </button>
      <p id="step-up-error" role="status" aria-live="polite" className="text-small text-alert">
        {state.error}
      </p>
    </form>
  );
}
