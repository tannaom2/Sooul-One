"use client";

import { useState, useTransition } from "react";
import { OUTCOME_LABEL, isFinal, type ReturnOutcome } from "@/lib/returns";
import { checkReturnedParcel, type ReturnResult } from "./return-actions";

export interface ReturnLine {
  id: string;
  name: string;
  batch: string | null;
  quantity: number;
  outcome: ReturnOutcome | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

/**
 * "Parcel back: check it" on a returned order (src/lib/returns.ts). Each line
 * gets back to stock, set aside or write off; decided lines show who decided.
 */
export function ReturnCheck({ orderId, lines, canWrite }: { orderId: string; lines: ReturnLine[]; canWrite: boolean }) {
  const open = lines.filter((l) => !isFinal(l.outcome));
  const [choice, setChoice] = useState<Record<string, ReturnOutcome | "">>(() => Object.fromEntries(open.map((l) => [l.id, l.outcome ?? ""])));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ReturnResult | null>(null);

  return (
    <section className="panel">
      <div className="panel-head">{open.length ? "Parcel back: check it" : "Returned parcel checked"}</div>
      <ul className="divide-y divide-rule">
        {lines.map((l) => (
          <li key={l.id} className="grid gap-2 p-3.5 text-small">
            <p>
              <span className="font-semibold">{l.name}</span> × {l.quantity}
              <span className="text-ink-faint"> · batch {l.batch ?? "not recorded"}</span>
            </p>
            {isFinal(l.outcome) || !canWrite ? (
              <p className="text-ink-soft">
                {l.outcome ? OUTCOME_LABEL[l.outcome].title : "Not checked yet"}
                {l.decidedBy && <span className="text-ink-faint"> · {l.decidedBy}, {l.decidedAt}</span>}
                {l.note && <span className="block text-micro">{l.note}</span>}
              </p>
            ) : (
              <>
                <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                  <legend className="sr-only">What happens to {l.name}</legend>
                  {(Object.keys(OUTCOME_LABEL) as ReturnOutcome[]).map((o) => (
                    <label key={o} className="flex items-center gap-1.5" title={OUTCOME_LABEL[o].hint}>
                      <input type="radio" name={`outcome-${l.id}`} checked={choice[l.id] === o} onChange={() => setChoice({ ...choice, [l.id]: o })} />
                      {OUTCOME_LABEL[o].title}
                    </label>
                  ))}
                </fieldset>
                <input
                  className="field text-small"
                  placeholder="Note (optional), e.g. seal broken"
                  maxLength={300}
                  value={notes[l.id] ?? l.note ?? ""}
                  onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })}
                  aria-label={`Note for ${l.name}`}
                />
                {l.outcome === "QUARANTINED" && <p className="text-micro text-ink-faint">Set aside by {l.decidedBy}, {l.decidedAt}.</p>}
                {result?.lineErrors?.[l.id] && <p className="text-micro text-alert">{result.lineErrors[l.id]}</p>}
              </>
            )}
          </li>
        ))}
      </ul>
      {canWrite && open.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-rule p-3.5">
          <button
            type="button"
            className="btn btn-solid"
            disabled={pending || open.some((l) => !choice[l.id])}
            onClick={() =>
              start(async () =>
                setResult(
                  await checkReturnedParcel(
                    orderId,
                    open.filter((l) => choice[l.id]).map((l) => ({ orderItemId: l.id, outcome: choice[l.id] as ReturnOutcome, note: notes[l.id] })),
                  ),
                ),
              )
            }
          >
            {pending ? "Saving…" : "Save the check"}
          </button>
          <span className="text-micro text-ink-faint">Back to stock adds the units to their batch at once.</span>
        </div>
      )}
      {result && (
        <p role="status" className="px-3.5 pb-3.5 text-small" style={{ color: result.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
          {result.message}
        </p>
      )}
    </section>
  );
}
