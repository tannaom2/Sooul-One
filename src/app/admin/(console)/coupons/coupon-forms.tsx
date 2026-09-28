"use client";

import { useActionState, useTransition } from "react";
import { keepFormValues, useClearOnSuccess } from "@/components/keep-form-values";
import { createCoupon, setCouponActive, type CouponResult } from "./actions";

const INITIAL: CouponResult = { ok: false };

export function CouponForm({ today }: { today: string }) {
  const [state, submit, pending] = useActionState(createCoupon, INITIAL);
  const formRef = useClearOnSuccess(state);
  const err = (k: string) => state.fieldErrors?.[k];

  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <input id={name} name={name} className="field" {...props} />
      {hint && <p className="mt-1 text-micro text-ink-faint">{hint}</p>}
      {err(name) && <p className="mt-1 text-micro text-alert">{err(name)}</p>}
    </div>
  );

  return (
    <form ref={formRef} onSubmit={keepFormValues(submit)} className="panel grid gap-4 p-4 sm:grid-cols-3">
      {field("code", "Code", { placeholder: "DIWALI20", autoComplete: "off", spellCheck: false, className: "field uppercase" })}
      <div>
        <label className="label" htmlFor="discountType">
          Discount type
        </label>
        <select id="discountType" name="discountType" className="field" defaultValue="PERCENTAGE">
          <option value="PERCENTAGE">Percentage off</option>
          <option value="FLAT">Flat amount off (₹)</option>
        </select>
      </div>
      {field("discountValue", "Discount", { type: "number", step: "0.01", min: "0" }, "e.g. 10 for 10%, or 100 for ₹100")}
      {field("minOrderValue", "Minimum order (₹)", { type: "number", step: "0.01", min: "0" }, "Optional. Judged after bundle offers.")}
      {field("maxUses", "Total uses allowed", { type: "number", min: "1", step: "1" }, "Optional. Blank means unlimited.")}
      <div />
      {field("validFrom", "Valid from", { type: "date", defaultValue: today })}
      {field("validUntil", "Valid until (inclusive)", { type: "date" })}
      <div className="flex items-end">
        <button className="btn btn-solid" disabled={pending}>
          {pending ? "Creating…" : "Create code"}
        </button>
      </div>
      <div aria-live="polite" role="status" className="sm:col-span-3">
        {state.message && (
          <p className="text-small" style={{ color: state.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

export function CouponToggle({ couponId, isActive }: { couponId: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => startTransition(() => setCouponActive(couponId, !isActive))}
      disabled={pending}
      className="px-2 py-1 text-small underline"
      style={{ color: isActive ? "var(--color-alert)" : undefined }}
    >
      {pending ? "Saving…" : isActive ? "Switch off" : "Switch on"}
    </button>
  );
}
