"use client";

import { useActionState } from "react";
import { RecoveryCodeList } from "@/components/recovery-code-list";
import { regenerateRecoveryCodes, type RecoveryResult } from "./actions";

const INITIAL: RecoveryResult = { ok: false };

export function RecoveryForm({ hasCodes }: { hasCodes: boolean }) {
  const [state, submit, pending] = useActionState(regenerateRecoveryCodes, INITIAL);

  if (state.ok && state.codes) return <RecoveryCodeList codes={state.codes} />;

  return (
    <form action={submit} className="grid max-w-sm gap-3">
      <div>
        <label className="label" htmlFor="code">
          Current code from your authenticator app
        </label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" className="field tabular tracking-[0.3em]" placeholder="000000" />
      </div>
      <button className="btn btn-solid justify-self-start" disabled={pending}>
        {pending ? "Making codes…" : hasCodes ? "Replace my recovery codes" : "Make my recovery codes"}
      </button>
      {hasCodes && <p className="text-micro text-ink-faint">Your current codes stop working as soon as the new ones are made.</p>}
      <div aria-live="polite" role="status">
        {state.message && <p className="text-small text-alert">{state.message}</p>}
      </div>
    </form>
  );
}
