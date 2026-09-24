"use client";

import { useActionState, useState } from "react";
import { keepFormValues } from "@/components/keep-form-values";
import { DEFAULT_PAUSE_MESSAGE, type StoreControls } from "@/lib/store-controls";
import { saveStoreControls, type ControlsResult } from "./actions";

const INITIAL: ControlsResult = { ok: false };

export function ControlsForm({ controls, onlinePayments }: { controls: StoreControls; onlinePayments: boolean }) {
  const [state, submit, pending] = useActionState(saveStoreControls, INITIAL);
  const [paused, setPaused] = useState(controls.ordersPaused);
  const [cod, setCod] = useState(controls.codEnabled);

  return (
    <form onSubmit={keepFormValues(submit)} className="grid gap-4">
      <fieldset className="panel grid gap-3 p-4">
        <legend className="label px-1">Orders</legend>
        <label className="flex items-start gap-3 text-small">
          <input type="checkbox" name="ordersPaused" className="mt-1" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          <span>
            <span className="font-semibold">Pause all orders</span>
            <span className="block text-ink-soft">
              For a stock problem, a holiday or anything else. Shoppers can still browse and fill their basket; checkout shows
              the message below instead of the order form.
            </span>
          </span>
        </label>
        <div>
          <label className="label" htmlFor="pauseMessage">
            Message shown at checkout while paused
          </label>
          <textarea
            id="pauseMessage"
            name="pauseMessage"
            rows={2}
            maxLength={300}
            className="field"
            defaultValue={controls.pauseMessage ?? ""}
            placeholder={DEFAULT_PAUSE_MESSAGE}
          />
          <p className="mt-1 text-micro text-ink-faint">Leave blank to use the default shown above.</p>
        </div>
      </fieldset>

      <fieldset className="panel grid gap-3 p-4">
        <legend className="label px-1">Payment and offers</legend>
        <label className="flex items-start gap-3 text-small">
          <input type="checkbox" name="codEnabled" className="mt-1" checked={cod} onChange={(e) => setCod(e.target.checked)} />
          <span>
            <span className="font-semibold">Offer cash on delivery</span>
            <span className="block text-ink-soft">Switch off during a spike in refused parcels (RTO).</span>
            {!cod && !onlinePayments && (
              <span className="mt-1 block font-semibold text-alert">
                Online payment isn&apos;t set up, so with cash on delivery off nobody can place an order.
              </span>
            )}
          </span>
        </label>
        <label className="flex items-start gap-3 text-small">
          <input type="checkbox" name="bundlesEnabled" className="mt-1" defaultChecked={controls.bundlesEnabled} />
          <span>
            <span className="font-semibold">Apply bundle offers</span>
            <span className="block text-ink-soft">Off stops every bundle discount in baskets and checkout at once.</span>
          </span>
        </label>
      </fieldset>

      <div className="flex items-center gap-4">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Saving…" : "Save controls"}
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
