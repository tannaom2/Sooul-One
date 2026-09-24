"use client";

import { useActionState, useState } from "react";
import { setOrderStatus, type ActionResult } from "../actions";
import { CLOSE_REASONS, STATUS_LABELS, isClosing, type OrderStatus } from "@/lib/order-lifecycle";

const INITIAL: ActionResult = { ok: false };

/**
 * Offers only the moves the order can make from where it is
 * (src/lib/order-lifecycle.ts); the action re-checks all of it. Carries the
 * status the page was showing, so a change someone else made in the meantime
 * isn't silently overwritten.
 */
export function OrderStatusForm({
  orderId,
  current,
  moves,
  tracking,
  courier,
  blockedNote,
}: {
  orderId: string;
  current: OrderStatus;
  moves: readonly OrderStatus[];
  tracking: string | null;
  courier: string | null;
  /** Why an expected move isn't offered, e.g. a paid online order can't be cancelled yet. */
  blockedNote?: string | null;
}) {
  const [state, submit, pending] = useActionState(setOrderStatus, INITIAL);
  const [target, setTarget] = useState<string>(current);
  // After a save the page re-renders with the new status, so a target equal to
  // it means "no move chosen", not "choose a reason for where it already is".
  const moving = target !== current;
  const reasons = moving && isClosing(target) ? CLOSE_REASONS[target] : null;
  const ended = moves.length === 0;
  const showTracking = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"].includes(current) || (moving && target === "SHIPPED");

  return (
    <form action={submit} className="grid gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedStatus" value={current} />

      <label className="text-small">
        <span className="mb-1 block font-medium">Status</span>
        <select name="status" className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value={current}>{STATUS_LABELS[current]} (now)</option>
          {moves.map((s) => (
            <option key={s} value={s}>
              → {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {moves.length === 0 && <span className="mt-1 block text-micro text-ink-faint">This order has ended; its status can&apos;t change.</span>}
        {blockedNote && <span className="mt-1 block text-micro text-ink-faint">{blockedNote}</span>}
      </label>

      {reasons && (
        <label className="text-small">
          <span className="mb-1 block font-medium">Reason</span>
          <select name="closeReason" className="field" defaultValue="" required>
            <option value="" disabled>
              Choose a reason
            </option>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
          {target === "CANCELLED" && <span className="mt-1 block text-micro text-ink-faint">Its stock goes back on sale.</span>}
          {(target === "RTO" || target === "RETURNED") && (
            <span className="mt-1 block text-micro text-ink-faint">
              Stock isn&apos;t added back automatically: check the parcel, then add sellable units as a batch.
            </span>
          )}
        </label>
      )}

      {showTracking && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-small">
            <span className="mb-1 block font-medium">Courier</span>
            <input name="courierPartner" className="field" defaultValue={courier ?? ""} placeholder="e.g. Delhivery" />
          </label>
          <label className="text-small">
            <span className="mb-1 block font-medium">Tracking number</span>
            <input name="trackingNumber" className="field tabular" defaultValue={tracking ?? ""} />
          </label>
        </div>
      )}

      {(!ended || showTracking) && (
        <button className="btn btn-outline justify-self-start" disabled={pending}>
          {pending ? "Saving…" : moving ? "Update" : "Save tracking"}
        </button>
      )}

      <div aria-live="polite" role="status">
        {state.message && (
          <p className="text-small" style={{ color: state.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
