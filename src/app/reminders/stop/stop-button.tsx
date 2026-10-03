"use client";

import { useState, useTransition } from "react";
import { stopRefillReminders, type RefillResult } from "@/app/order/[orderNumber]/refill-actions";

export function StopButton({ orderNumber, token }: { orderNumber: string; token: string | null }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RefillResult | null>(null);
  if (result?.ok) {
    return (
      <p role="status" className="mt-6 text-lead font-semibold text-veg">
        {result.message}
      </p>
    );
  }
  return (
    <div className="mt-6 grid gap-3">
      <div>
        <button type="button" className="btn btn-solid" disabled={pending} onClick={() => start(async () => setResult(await stopRefillReminders(orderNumber, token)))}>
          {pending ? "Stopping…" : "Stop refill reminders"}
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
