"use client";

import { useState, useTransition } from "react";
import { stopRefillReminders, type RefillResult } from "@/app/order/[orderNumber]/refill-actions";
import { stopFollowUpEmails } from "@/app/order/[orderNumber]/follow-up-actions";

export function StopButton({ orderNumber, token, kind }: { orderNumber: string; token: string | null; kind: "refill" | "follow-ups" }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RefillResult | null>(null);
  if (result?.ok) {
    return (
      <p role="status" className="mt-6 text-lead font-semibold text-veg">
        {result.message}
      </p>
    );
  }
  const stop = kind === "follow-ups" ? stopFollowUpEmails : stopRefillReminders;
  return (
    <div className="mt-6 grid gap-3">
      <div>
        <button type="button" className="btn btn-solid" disabled={pending} onClick={() => start(async () => setResult(await stop(orderNumber, token)))}>
          {pending ? "Stopping…" : kind === "follow-ups" ? "Stop these emails" : "Stop refill reminders"}
        </button>
      </div>
      {result && (
        <p role="status" className="text-small text-alert">
          {result.message}
        </p>
      )}
    </div>
  );
}
