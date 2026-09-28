"use client";

import { useActionState } from "react";
import type { ActionResult } from "../actions";

/**
 * A small form around a server action: fields in, the action's message out.
 * The box editor has many small forms (details, each section, pins), so
 * they share this rather than each wiring useActionState by hand.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className = "grid gap-3",
  confirmText,
  variant = "solid",
}: {
  action: (prev: ActionResult, form: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children?: React.ReactNode;
  className?: string;
  confirmText?: string;
  variant?: "solid" | "outline";
}) {
  const [state, formAction, pending] = useActionState(action, { ok: true } as ActionResult);
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirmText && !confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`btn ${variant === "solid" ? "btn-solid" : "btn-outline"} px-3 py-1.5 text-small`}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <span aria-live="polite" role="status" className={`text-small ${state.ok ? "text-veg" : "text-alert"}`}>
          {state.message}
        </span>
      </div>
    </form>
  );
}
