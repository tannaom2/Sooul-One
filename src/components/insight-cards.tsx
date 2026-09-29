"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Insight, InsightAction } from "@/lib/intel/insights-engine";
import { METHOD_LABEL } from "@/lib/intel/payment-health";
import { disableCodForPincode, setPaymentAdvisory } from "@/app/admin/(console)/insight-actions";

/**
 * Insight cards, from the built-in rules or the local copilot (same shape:
 * src/lib/intel/insights-engine.ts). Buttons that change the store are shown
 * only to the owner and are re-checked on the server when clicked.
 */

const TONE: Record<Insight["severity"], { label: string; bar: string }> = {
  critical: { label: "Act now", bar: "var(--color-chart-bad)" },
  warning: { label: "Worth a look", bar: "var(--color-chart-1)" },
  info: { label: "For information", bar: "var(--color-chart-2)" },
};

function actionLabel(action: InsightAction): string {
  switch (action.type) {
    case "DISABLE_COD":
      return `Disable COD for ${action.pincode}`;
    case "PRIORITIZE_BACKUP_METHOD":
      return `Prioritize backup over ${METHOD_LABEL[action.method] ?? action.method}`;
    case "CLEAR_ADVISORY":
      return `Clear ${METHOD_LABEL[action.method] ?? action.method} note`;
    case "EXPORT_COHORT":
      return "Export cohort (CSV)";
    case "OPEN":
      return action.label;
  }
}

function ActionButton({ action, canAct }: { action: InsightAction; canAct: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  if (action.type === "OPEN") {
    return (
      <Link href={action.href} className="btn btn-outline px-3 py-1.5 text-small">
        {action.label}
      </Link>
    );
  }
  if (!canAct) return <p className="text-micro text-ink-faint">The owner can act on this.</p>;
  if (action.type === "EXPORT_COHORT") {
    // Customers' contact details: needs the same fresh code as the activity log
    // (the route sends you to confirm first), is logged, and downloads as a file.
    return (
      <a href="/admin/activity/export/churn" className="btn btn-outline px-3 py-1.5 text-small">
        {actionLabel(action)}
      </a>
    );
  }
  const run = () =>
    start(async () => {
      const confirmText =
        action.type === "DISABLE_COD"
          ? `Switch off cash on delivery for ${action.pincode}? Shoppers there will be asked to pay online.`
          : action.type === "PRIORITIZE_BACKUP_METHOD"
            ? `Tell shoppers ${METHOD_LABEL[action.method] ?? action.method} is having trouble and select another way to pay first at checkout?`
            : null;
      if (confirmText && !window.confirm(confirmText)) return;
      const r =
        action.type === "DISABLE_COD"
          ? await disableCodForPincode(action.pincode)
          : await setPaymentAdvisory(action.method, action.type === "PRIORITIZE_BACKUP_METHOD");
      setResult(r);
    });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={run} disabled={pending || result?.ok} className="btn btn-solid px-3 py-1.5 text-small">
        {pending ? "Working…" : actionLabel(action)}
      </button>
      <span role="status" aria-live="polite" className={`text-small ${result?.ok ? "text-veg" : "text-alert"}`}>
        {result?.message}
      </span>
    </div>
  );
}

export function InsightCards({ insights, canAct, compact = false }: { insights: readonly Insight[]; canAct: boolean; compact?: boolean }) {
  if (insights.length === 0) return <p className="text-small text-ink-soft">Nothing needs attention right now.</p>;
  return (
    <ul className={`grid gap-3 ${compact ? "" : "md:grid-cols-2 xl:grid-cols-3"}`}>
      {insights.map((i) => (
        <li key={i.id} className="panel flex flex-col overflow-hidden">
          <div aria-hidden className="h-1" style={{ background: TONE[i.severity].bar }} />
          <div className="flex flex-1 flex-col gap-2 p-4">
            <p className="text-micro font-semibold tracking-wide text-ink-faint uppercase">{TONE[i.severity].label}</p>
            <p className="font-semibold">{i.title}</p>
            <p className="text-small text-ink-soft">{i.detail}</p>
            {i.action && (
              <div className="mt-auto pt-2">
                <ActionButton action={i.action} canAct={canAct} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
