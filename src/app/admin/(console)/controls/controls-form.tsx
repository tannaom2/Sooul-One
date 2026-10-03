"use client";

import { useActionState, useState } from "react";
import { keepFormValues } from "@/components/keep-form-values";
import { DEFAULT_PAUSE_MESSAGE, type StoreControls } from "@/lib/store-controls";
import { THEME_LABEL, type ThemeSettings } from "@/lib/theme";
import type { CheckoutCodSettings } from "@/server/intel";
import { saveStoreControls, type ControlsResult } from "./actions";

const INITIAL: ControlsResult = { ok: false };

export interface DeliveryFees {
  deliveryFee: number;
  freeDeliveryAbove: number;
}

export function ControlsForm({
  controls,
  theme,
  fees,
  codRules,
  onlinePayments,
}: {
  controls: StoreControls;
  theme: ThemeSettings;
  fees: DeliveryFees;
  codRules: CheckoutCodSettings;
  onlinePayments: boolean;
}) {
  const [state, submit, pending] = useActionState(saveStoreControls, INITIAL);
  const [paused, setPaused] = useState(controls.ordersPaused);
  const [cod, setCod] = useState(controls.codEnabled);
  const [toggleVisible, setToggleVisible] = useState(theme.toggleVisible);
  const [autoBlock, setAutoBlock] = useState(codRules.codAutoBlock);

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

      <fieldset className="panel grid gap-3 p-4">
        <legend className="label px-1">Delivery charges</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="deliveryFee">
              Delivery charge (₹, incl. GST)
            </label>
            <input id="deliveryFee" name="deliveryFee" type="number" min={0} max={1000} step={1} className="field" defaultValue={fees.deliveryFee} required />
            <p className="mt-1 text-micro text-ink-faint">On orders below the free-delivery amount. 0 makes delivery free on every order.</p>
          </div>
          <div>
            <label className="label" htmlFor="freeDeliveryAbove">
              Free delivery from (₹, incl. GST)
            </label>
            <input id="freeDeliveryAbove" name="freeDeliveryAbove" type="number" min={0} max={100000} step={1} className="field" defaultValue={fees.freeDeliveryAbove} required />
            <p className="mt-1 text-micro text-ink-faint">Checked against the order after discounts and offers.</p>
          </div>
        </div>
        <p className="text-small text-ink-soft">
          Checkout, the basket&apos;s free-delivery bar, the Help assistant and any text using {"{deliveryFee}"} or {"{freeDelivery}"} (top
          bar, FAQs, site text) change together. Orders already placed keep what they were charged. Update the Shipping policy page
          to match.
        </p>
      </fieldset>

      <fieldset className="panel grid gap-3 p-4" disabled={!cod}>
        <legend className="label px-1">Cash on delivery rules</legend>
        {!cod && <p className="text-small text-ink-soft">Cash on delivery is off, so these rules don&apos;t apply right now.</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="codMinOrderValue">
              Cash on delivery from (₹, incl. GST)
            </label>
            <input
              id="codMinOrderValue"
              name="codMinOrderValue"
              type="number"
              min={1}
              max={100000}
              step={1}
              className="field"
              defaultValue={codRules.codMinOrderValue ?? ""}
              placeholder="No minimum"
            />
            <p className="mt-1 text-micro text-ink-faint">On a small order, one refused parcel costs more than several delivered ones earn.</p>
          </div>
          <div>
            <label className="label" htmlFor="codMaxOrderValue">
              Cash on delivery up to (₹, incl. GST)
            </label>
            <input
              id="codMaxOrderValue"
              name="codMaxOrderValue"
              type="number"
              min={1}
              max={100000}
              step={1}
              className="field"
              defaultValue={codRules.codMaxOrderValue ?? ""}
              placeholder="No limit"
            />
            <p className="mt-1 text-micro text-ink-faint">Larger orders are asked to pay online: a refused big parcel costs the most.</p>
          </div>
          <div>
            <label className="label" htmlFor="preferredPayment">
              Checkout selects first
            </label>
            <select id="preferredPayment" name="preferredPayment" className="field" defaultValue={codRules.preferredPayment}>
              <option value="ONLINE">UPI (pay online)</option>
              <option value="COD">Cash on delivery</option>
            </select>
            <p className="mt-1 text-micro text-ink-faint">Shoppers can still choose any option offered.</p>
          </div>
        </div>
        <label className="flex items-start gap-3 text-small">
          <input type="checkbox" name="codAutoBlock" className="mt-1" checked={autoBlock} onChange={(e) => setAutoBlock(e.target.checked)} />
          <span>
            <span className="font-semibold">Switch off cash on delivery by itself for pincodes whose parcels keep coming back</span>
            <span className="block text-ink-soft">
              Worked out from every finished COD parcel to that pincode. Your own rule for a pincode (Analytics → Pincodes) always
              wins, either way.
            </span>
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="codAutoBlockRtoPercent">
              When at least this share came back (%)
            </label>
            <input id="codAutoBlockRtoPercent" name="codAutoBlockRtoPercent" type="number" min={5} max={100} className="field" defaultValue={codRules.codAutoBlockRtoPercent} disabled={!autoBlock} required />
          </div>
          <div>
            <label className="label" htmlFor="codAutoBlockMinShipped">
              Out of at least this many COD parcels
            </label>
            <input id="codAutoBlockMinShipped" name="codAutoBlockMinShipped" type="number" min={1} max={100} className="field" defaultValue={codRules.codAutoBlockMinShipped} disabled={!autoBlock} required />
          </div>
        </div>
      </fieldset>

      <fieldset className="panel grid gap-3 p-4">
        <legend className="label px-1">Storefront look</legend>
        <label className="flex items-start gap-3 text-small">
          <input
            type="checkbox"
            name="themeToggleVisible"
            className="mt-1"
            checked={toggleVisible}
            onChange={(e) => setToggleVisible(e.target.checked)}
          />
          <span>
            <span className="font-semibold">Allow customers to switch Day/Night mode on Storefront</span>
            <span className="block text-ink-soft">
              A sun/moon button in the storefront header. Each shopper&apos;s choice is kept on their device; until they choose,
              the storefront follows their phone or computer&apos;s own setting.
            </span>
          </span>
        </label>
        <div>
          <label className="label" htmlFor="forcedTheme">
            Default Storefront Theme when toggle is hidden
          </label>
          <select id="forcedTheme" name="forcedTheme" className="field max-w-xs" defaultValue={theme.forcedTheme === "dark" ? "DARK" : "LIGHT"}>
            <option value="LIGHT">{THEME_LABEL.light}</option>
            <option value="DARK">{THEME_LABEL.dark}</option>
          </select>
          <p className="mt-1 text-micro text-ink-faint">
            {toggleVisible
              ? "Used only while the switch above is off."
              : "Every shopper sees this, whatever they chose before. The owner console keeps its own switch, in the sidebar."}
          </p>
        </div>
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
