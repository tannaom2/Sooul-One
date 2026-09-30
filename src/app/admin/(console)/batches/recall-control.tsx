"use client";

import { useState, useTransition } from "react";
import { setBatchRecall } from "./actions";

/** Recall a batch (with the note shoppers will read on /verify), or lift a recall. */
export function RecallControl({ batchId, batchNumber, recalled, note }: { batchId: string; batchNumber: string; recalled: boolean; note: string | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (recalled) {
    return (
      <span className="flex items-center gap-2">
        <span className="font-semibold text-alert">Recalled</span>
        <button
          type="button"
          className="text-micro underline underline-offset-2"
          disabled={pending}
          onClick={() => confirm(`Lift the recall on ${batchNumber}?`) && start(async () => setMessage((await setBatchRecall(batchId, false, "")).message))}
        >
          Lift
        </button>
        {message && <span className="text-micro text-ink-soft">{message}</span>}
      </span>
    );
  }
  if (!open) {
    return (
      <button type="button" className="text-micro underline underline-offset-2" onClick={() => setOpen(true)}>
        Recall…
      </button>
    );
  }
  return (
    <span className="grid w-full gap-2 sm:w-80">
      <label className="text-micro" htmlFor={`recall-${batchId}`}>
        What shoppers should know (shown on the batch check)
      </label>
      <textarea id={`recall-${batchId}`} className="field text-small" rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder="Please don't consume it. Contact us for a full refund." />
      <span className="flex gap-2">
        <button
          type="button"
          className="btn btn-solid"
          disabled={pending}
          onClick={() => start(async () => setMessage((await setBatchRecall(batchId, true, text)).message))}
        >
          Recall {batchNumber}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
      {message && <span className="text-micro text-ink-soft">{message}</span>}
    </span>
  );
}
