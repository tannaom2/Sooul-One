"use client";

import { useActionState } from "react";
import { addOrderNote, type ActionResult } from "../../actions";

const INITIAL: ActionResult = { ok: false };

export function OrderNoteForm({ orderId }: { orderId: string }) {
  const [state, submit, pending] = useActionState(addOrderNote, INITIAL);

  return (
    <form action={submit} className="grid gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <label className="label" htmlFor="note">
        Add an internal note
      </label>
      <textarea
        id="note"
        name="note"
        rows={2}
        maxLength={1000}
        className="field"
        placeholder="e.g. Customer called to change delivery time…"
      />
      <div className="flex items-center gap-3">
        <button className="btn btn-outline px-4 py-2 text-small" disabled={pending}>
          {pending ? "Saving…" : "Add note"}
        </button>
        <div aria-live="polite" role="status">
          {state.message && (
            <p className="text-small" style={{ color: state.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
              {state.message}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
