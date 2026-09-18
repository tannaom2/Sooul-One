"use client";

import { useActionState } from "react";
import { setOrderStatus, type ActionResult } from "../actions";

const INITIAL: ActionResult = { ok: false };

const STATUSES = ["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"];

export function OrderStatusForm({
  orderId,
  current,
  tracking,
}: {
  orderId: string;
  current: string;
  tracking: string | null;
}) {
  const [state, submit, pending] = useActionState(setOrderStatus, INITIAL);

  return (
    <form action={submit} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="orderId" value={orderId} />

      <label className="text-small">
        <span className="mb-1 block font-medium">Status</span>
        <select name="status" className="field" defaultValue={current}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.toLowerCase()}</option>
          ))}
        </select>
      </label>

      <label className="text-small">
        <span className="mb-1 block font-medium">Tracking number</span>
        <input name="trackingNumber" className="field tabular" defaultValue={tracking ?? ""} />
      </label>

      <button className="btn btn-outline" disabled={pending}>
        {pending ? "Saving…" : "Update"}
      </button>

      {state.message && (
        <p className="text-small" style={{ color: state.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
