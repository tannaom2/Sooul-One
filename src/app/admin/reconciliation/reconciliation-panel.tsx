"use client";

import { useState, useTransition } from "react";
import { runReconciliation } from "./actions";
import type { ReconciliationResult } from "@/lib/reconciliation";

const KIND_LABEL: Record<string, string> = {
  AMOUNT_MISMATCH: "Amount mismatch",
  LOCAL_PAID_RAZORPAY_DISAGREES: "We say paid, Razorpay disagrees",
  LOCAL_PENDING_RAZORPAY_PAID: "Razorpay paid, we say pending",
  RAZORPAY_ORDER_NOT_FOUND: "Order not found at Razorpay",
  PAYMENT_WITHOUT_LOCAL_ORDER: "Payment with no local order",
};

/**
 * Severity ordering for display: the two "money moved but our records
 * disagree" cases surface first, since those are the ones worth an owner's
 * attention over a data-entry oddity.
 */
const KIND_ORDER = [
  "PAYMENT_WITHOUT_LOCAL_ORDER",
  "LOCAL_PENDING_RAZORPAY_PAID",
  "LOCAL_PAID_RAZORPAY_DISAGREES",
  "AMOUNT_MISMATCH",
  "RAZORPAY_ORDER_NOT_FOUND",
];

export function ReconciliationPanel() {
  const [windowDays, setWindowDays] = useState(30);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        setResult(await runReconciliation(windowDays));
      } catch {
        setError("That didn't run. Check Razorpay credentials and try again.");
      }
    });
  }

  const sortedFindings = result
    ? [...result.findings].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    : [];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label" htmlFor="windowDays">
            Look back (days)
          </label>
          <input
            id="windowDays"
            type="number"
            min={1}
            max={365}
            className="field tabular w-32"
            value={windowDays}
            onChange={(e) => setWindowDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
          />
        </div>
        <button onClick={run} disabled={pending} className="btn btn-solid">
          {pending ? "Checking against Razorpay…" : "Run reconciliation"}
        </button>
      </div>

      {error && <p className="text-small text-alert">{error}</p>}

      {result && (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="panel p-3.5">
              <p className="text-micro text-ink-faint">Local orders checked</p>
              <p className="tabular text-lead font-bold">{result.localOrdersChecked}</p>
            </div>
            <div className="panel p-3.5">
              <p className="text-micro text-ink-faint">Razorpay payments checked</p>
              <p className="tabular text-lead font-bold">{result.razorpayPaymentsChecked}</p>
            </div>
            <div className="panel p-3.5" style={{ borderColor: sortedFindings.length ? "var(--color-alert)" : undefined }}>
              <p className="text-micro text-ink-faint">Findings</p>
              <p className="tabular text-lead font-bold">{sortedFindings.length}</p>
            </div>
          </div>

          {sortedFindings.length === 0 ? (
            <p className="panel p-4 text-small text-veg">
              No discrepancies for the last {result.windowDays} days — our records agree with Razorpay&apos;s.
            </p>
          ) : (
            <div className="grid gap-3">
              {sortedFindings.map((f, i) => (
                <div key={i} className="panel border-l-4 border-alert p-3.5">
                  <p className="text-small font-semibold">{KIND_LABEL[f.kind] ?? f.kind}</p>
                  <p className="mt-1 text-small text-ink-soft">{f.detail}</p>
                  <p className="mt-2 text-micro tabular text-ink-faint">
                    {f.orderNumber && <>Order {f.orderNumber} · </>}
                    {f.razorpayOrderId && <>Razorpay order {f.razorpayOrderId} · </>}
                    {f.razorpayPaymentId && <>Payment {f.razorpayPaymentId}</>}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
