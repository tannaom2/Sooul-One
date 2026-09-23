"use client";

import { useActionState } from "react";
import { signIn, verifyMfa, type LoginState } from "./actions";

const INITIAL: LoginState = { stage: "PASSWORD" };

export default function AdminLogin() {
  const [passwordState, submitPassword, passwordPending] = useActionState(signIn, INITIAL);
  const [mfaState, submitMfa, mfaPending] = useActionState(verifyMfa, INITIAL);

  // mfaState only reflects reality once verifyMfa has actually run (it carries
  // an error either way — success redirects instead of returning state).
  // Until then, defer to whether the password step just succeeded.
  const mfaAttempted = mfaState.error !== undefined;
  const onMfaStage = mfaAttempted ? mfaState.stage === "MFA" : passwordState.stage === "MFA";
  const error = onMfaStage ? mfaState.error : passwordState.error ?? mfaState.error;

  return (
    <div className="mx-auto max-w-sm px-5 py-20">
      <h1 className="text-h2 font-extrabold">Owner console</h1>
      <p className="mt-2 text-small text-ink-soft">
        {onMfaStage
          ? "Enter the 6-digit code from your authenticator app."
          : "Sign in to manage the catalogue and orders."}
      </p>

      {onMfaStage ? (
        <form action={submitMfa} className="mt-8 grid gap-4">
          <div>
            <label className="label" htmlFor="code">Authentication code</label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              className="field tabular tracking-[0.3em]"
              placeholder="000000"
            />
          </div>
          <button className="btn btn-solid" disabled={mfaPending}>
            {mfaPending ? "Checking…" : "Verify code"}
          </button>
        </form>
      ) : (
        <form action={submitPassword} className="mt-8 grid gap-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" className="field" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              className="field"
            />
          </div>
          <button className="btn btn-solid" disabled={passwordPending}>
            {passwordPending ? "Checking…" : "Continue"}
          </button>
        </form>
      )}

      <div aria-live="polite" role="status">
        {error && <p className="mt-4 text-small text-alert">{error}</p>}
      </div>
    </div>
  );
}
