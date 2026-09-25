"use client";

import { useActionState, useState } from "react";
import { authenticate, type LoginState } from "./actions";
import { keepFormValues } from "@/components/keep-form-values";

const INITIAL: LoginState = { stage: "PASSWORD" };

const INTRO: Record<LoginState["stage"], string> = {
  PASSWORD: "Sign in to manage the catalogue and orders.",
  MFA: "Enter the 6-digit code from your authenticator app.",
  ENROL: "First sign-in: choose your own password and set up your authenticator app.",
};

export default function AdminLogin() {
  const [state, submit, pending] = useActionState(authenticate, INITIAL);
  // Recovery codes contain letters, so the 6-digit field's number keyboard won't do.
  const [useRecovery, setUseRecovery] = useState(false);
  const button = (idle: string) => (
    <button className="btn btn-solid" disabled={pending}>
      {pending ? "Checking…" : idle}
    </button>
  );

  return (
    <div className={`mx-auto px-5 py-20 ${state.stage === "ENROL" ? "max-w-md" : "max-w-sm"}`}>
      <h1 className="text-h2 font-extrabold">Owner console</h1>
      <p className="mt-2 text-small text-ink-soft">{INTRO[state.stage]}</p>

      {state.stage === "MFA" && (
        <form action={submit} className="mt-8 grid gap-4">
          <input type="hidden" name="step" value="mfa" />
          <div>
            <label className="label" htmlFor="code">{useRecovery ? "Recovery code" : "Authentication code"}</label>
            <input
              key={useRecovery ? "recovery" : "totp"}
              id="code"
              name="code"
              inputMode={useRecovery ? "text" : "numeric"}
              autoComplete={useRecovery ? "off" : "one-time-code"}
              autoCapitalize={useRecovery ? "characters" : undefined}
              spellCheck={false}
              autoFocus
              className="field tabular tracking-[0.3em]"
              placeholder={useRecovery ? "XXXXX-XXXXX" : "000000"}
            />
          </div>
          {button(useRecovery ? "Use recovery code" : "Verify code")}
          <button type="button" onClick={() => setUseRecovery((v) => !v)} className="justify-self-start text-small underline">
            {useRecovery ? "Use my authenticator app instead" : "Lost your phone? Use a recovery code"}
          </button>
        </form>
      )}

      {state.stage === "ENROL" && (
        <form onSubmit={keepFormValues(submit)} className="mt-8 grid gap-5">
          <input type="hidden" name="step" value="enrol" />
          <input type="hidden" name="setupKey" value={state.setupKey} />

          <fieldset className="grid gap-4">
            <legend className="mb-2 font-semibold">1. Your password</legend>
            <div>
              <label className="label" htmlFor="newPassword">New password (at least 12 characters)</label>
              <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="confirmPassword">Type it again</label>
              <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} className="field" />
            </div>
          </fieldset>

          <fieldset className="grid gap-3">
            <legend className="mb-2 font-semibold">2. Your authenticator app</legend>
            <p className="text-small text-ink-soft">
              In Google Authenticator, Authy or 1Password, add an account and scan this code.
            </p>
            {state.setupQrSvg && (
              <div
                aria-label="QR code for your authenticator app"
                role="img"
                className="w-44 bg-white p-2"
                // Generated server-side by the qrcode library from our own otpauth URI.
                dangerouslySetInnerHTML={{ __html: state.setupQrSvg }}
              />
            )}
            <p className="text-small text-ink-soft">
              Can&apos;t scan? Enter this key instead:{" "}
              <code className="tabular break-all select-all">{state.setupKey}</code>
            </p>
            <div>
              <label className="label" htmlFor="code">The 6-digit code it now shows</label>
              <input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="field tabular tracking-[0.3em]"
                placeholder="000000"
              />
            </div>
          </fieldset>

          {button("Finish setup")}
        </form>
      )}

      {state.stage === "PASSWORD" && (
        <form onSubmit={keepFormValues(submit)} className="mt-8 grid gap-4">
          <input type="hidden" name="step" value="password" />
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
          {button("Continue")}
        </form>
      )}

      <div aria-live="polite" role="status">
        {state.error && <p className="mt-4 text-small text-alert">{state.error}</p>}
      </div>
    </div>
  );
}
