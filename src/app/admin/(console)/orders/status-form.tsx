"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { setOrderStatus, type ActionResult } from "../actions";
import { CLOSE_REASONS, STATUS_LABELS, isClosing, type OrderStatus } from "@/lib/order-lifecycle";

const INITIAL: ActionResult = { ok: false };

/** Couriers offered as you type; any other name can still be entered. */
const COURIERS = ["Delhivery", "Shiprocket", "Blue Dart", "DTDC", "Ecom Express", "Xpressbees", "Shadowfax", "India Post"];
/** The last courier used on this computer, so the next parcel starts with it. A convenience only. */
const LAST_COURIER = "soulone.lastCourier";

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
  // One-click moves for the packing run: start packing a paid order; mark a packed one shipped.
  const quick = current === "PAID" && moves.includes("PROCESSING") ? { to: "PROCESSING", label: "Start packing" } : current === "PROCESSING" && moves.includes("SHIPPED") ? { to: "SHIPPED", label: "Mark shipped" } : null;
  const courierRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      const last = localStorage.getItem(LAST_COURIER);
      if (last && courierRef.current && !courierRef.current.value) courierRef.current.value = last;
    } catch {
      // Storage blocked: the field just starts empty.
    }
  }, []);
  const rememberCourier = () => {
    try {
      const v = courierRef.current?.value.trim();
      if (v) localStorage.setItem(LAST_COURIER, v);
    } catch {}
  };

  return (
    <form action={submit} onSubmit={rememberCourier} className="grid gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedStatus" value={current} />
      {/* Before the status list, so this button's status is the one the form sends. */}
      {quick && (
        <button name="status" value={quick.to} className="btn btn-solid justify-self-start" disabled={pending}>
          {pending ? "Saving…" : quick.label}
        </button>
      )}
      {quick?.to === "SHIPPED" && <p className="-mt-1 text-micro text-ink-faint">Fill in the courier and tracking below first; the customer is emailed them.</p>}

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
              Stock isn&apos;t added back automatically: once the parcel is back, check it in the &ldquo;Parcel back&rdquo; panel that appears on this page.
            </span>
          )}
        </label>
      )}

      {showTracking && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-small">
            <span className="mb-1 block font-medium">Courier</span>
            <input ref={courierRef} name="courierPartner" className="field" defaultValue={courier ?? ""} placeholder="e.g. Delhivery" list="couriers" maxLength={60} />
            <datalist id="couriers">
              {COURIERS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="text-small">
            <span className="mb-1 block font-medium">Tracking number</span>
            <input name="trackingNumber" className="field tabular" defaultValue={tracking ?? ""} />
          </label>
        </div>
      )}

      {(!ended || showTracking) && (
        <button className="btn btn-outline justify-self-start" disabled={pending} name="status" value={target}>
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
