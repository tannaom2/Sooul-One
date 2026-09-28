"use client";

import { useActionState } from "react";
import { addTeamMember, changeRole, resetAccess, setActive, type TeamResult } from "./actions";
import { keepFormValues, useClearOnSuccess } from "@/components/keep-form-values";

const INITIAL: TeamResult = { ok: false };

type RoleOption = { role: string; label: string; description: string };

function Status({ state }: { state: TeamResult }) {
  return (
    <div aria-live="polite" role="status">
      {state.message && (
        <p className="text-small" style={{ color: state.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
          {state.message}
        </p>
      )}
    </div>
  );
}

/** The one time a temporary password is visible. */
function TemporaryPassword({ state }: { state: TeamResult }) {
  if (!state.ok || !state.temporaryPassword) return null;
  return (
    <div className="mt-3 border-l-4 border-caution bg-shelf p-3 text-small">
      <p className="font-semibold">Send these to them privately (not in a group chat):</p>
      <p className="mt-2">
        Sign in at <code>/admin/login</code> with <span className="break-all">{state.email}</span> and the temporary
        password <code className="tabular font-semibold select-all">{state.temporaryPassword}</code>
      </p>
      <p className="mt-2 text-ink-soft">
        They&apos;ll choose their own password and set up an authenticator app at first sign-in. This password is shown
        only now and stops working once they&apos;ve set up.
      </p>
    </div>
  );
}

export function AddMemberForm({ roles }: { roles: RoleOption[] }) {
  const [state, submit, pending] = useActionState(addTeamMember, INITIAL);
  const formRef = useClearOnSuccess(state);

  return (
    <div>
      <form ref={formRef} onSubmit={keepFormValues(submit)} className="grid gap-3 sm:grid-cols-[1fr_1fr_12rem_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="member-name">Name</label>
          <input id="member-name" name="name" autoComplete="off" maxLength={100} required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="member-email">Email</label>
          <input id="member-email" name="email" type="email" autoComplete="off" spellCheck={false} maxLength={200} required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="member-role">Role</label>
          <select id="member-role" name="role" defaultValue="FULFILMENT" className="field">
            {roles.map((r) => (
              <option key={r.role} value={r.role}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Adding…" : "Add person"}
        </button>
      </form>
      <div className="mt-2">
        <Status state={state} />
        <TemporaryPassword state={state} />
      </div>
    </div>
  );
}

export function MemberControls({
  id,
  name,
  role,
  isActive,
  roles,
}: {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  roles: RoleOption[];
}) {
  const [roleState, submitRole, rolePending] = useActionState(changeRole, INITIAL);
  const [activeState, submitActive, activePending] = useActionState(setActive, INITIAL);
  const [resetState, submitReset, resetPending] = useActionState(resetAccess, INITIAL);

  // `contents`: the buttons sit in the row's right-hand column, while messages
  // and the one-time password take a full-width line below, instead of
  // stretching that column and pushing the buttons above the name.
  return (
    <div className="contents">
      <div className="flex flex-wrap items-center gap-2 lg:justify-self-end">
        <form action={submitRole} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <label className="sr-only" htmlFor={`role-${id}`}>
            Role for {name}
          </label>
          <select id={`role-${id}`} name="role" defaultValue={role} className="field w-auto py-1.5 text-small" disabled={!isActive}>
            {roles.map((r) => (
              <option key={r.role} value={r.role}>
                {r.label}
              </option>
            ))}
          </select>
          <button className="btn btn-outline px-3 py-1.5 text-small" disabled={rolePending || !isActive}>
            {rolePending ? "Saving…" : "Save role"}
          </button>
        </form>

        <form
          action={submitReset}
          onSubmit={(e) => {
            if (!confirm(`Reset access for ${name}? They'll be signed out everywhere and need a new temporary password.`)) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={id} />
          <button className="btn btn-outline px-3 py-1.5 text-small" disabled={resetPending || !isActive}>
            {resetPending ? "Resetting…" : "Reset access"}
          </button>
        </form>

        <form
          action={submitActive}
          onSubmit={(e) => {
            if (isActive && !confirm(`Deactivate ${name}? They'll be signed out everywhere straight away.`)) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="isActive" value={String(!isActive)} />
          <button
            className="px-2 py-1.5 text-small underline"
            style={{ color: isActive ? "var(--color-alert)" : undefined }}
            disabled={activePending}
          >
            {activePending ? "Saving…" : isActive ? "Deactivate" : "Reactivate"}
          </button>
        </form>
      </div>
      <div className="grid gap-2 empty:hidden lg:col-span-2">
        <Status state={roleState} />
        <Status state={activeState} />
        <Status state={resetState} />
        <TemporaryPassword state={resetState} />
      </div>
    </div>
  );
}
