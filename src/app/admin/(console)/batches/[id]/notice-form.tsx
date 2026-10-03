"use client";

import { useState, useTransition } from "react";
import { sendRecallNoticesAction } from "../actions";

/** The buyer notice: edit, see who it goes to, confirm, send (owner only). */
export function NoticeForm({ batchId, initial, toEmail, alreadySent, toCall, sentAt }: { batchId: string; initial: string; toEmail: number; alreadySent: number; toCall: number; sentAt: string | null }) {
  const [text, setText] = useState(initial);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="grid gap-3">
      <label className="label" htmlFor="recall-notice">
        Notice to buyers
      </label>
      <textarea id="recall-notice" rows={9} className="field" value={text} onChange={(e) => setText(e.target.value)} maxLength={3000} />
      <p className="text-micro text-ink-faint">
        Each email starts with the product, batch and the buyer&apos;s order number, and ends with your customer care contact.
        {sentAt && ` Last sent ${sentAt} to ${alreadySent} ${alreadySent === 1 ? "buyer" : "buyers"}; they aren't emailed again.`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-solid"
          disabled={pending || toEmail === 0 || result?.ok}
          onClick={() => {
            if (!confirm(`Email this notice to ${toEmail} ${toEmail === 1 ? "buyer" : "buyers"}? It can't be unsent.`)) return;
            start(async () => setResult(await sendRecallNoticesAction(batchId, text)));
          }}
        >
          {pending ? "Sending…" : result?.ok || (toEmail === 0 && alreadySent > 0) ? "Every buyer emailed" : `Email ${toEmail} ${alreadySent ? "more " : ""}${toEmail === 1 ? "buyer" : "buyers"}`}
        </button>
        {toCall > 0 && <span className="text-small text-ink-soft">{toCall} without an email: call them (marked below).</span>}
      </div>
      {result && (
        <p role="status" className="text-small" style={{ color: result.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
          {result.message}
        </p>
      )}
    </div>
  );
}
