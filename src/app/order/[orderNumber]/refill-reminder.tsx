"use client";

import { useState, useTransition } from "react";
import { askRefillReminder, stopRefillReminders, type RefillResult } from "./refill-actions";

/**
 * "Remind me before it runs out" (benchmark gap R2), on the order page of an
 * order with supplements. Asks for an email only when the order has none.
 */
export function RefillReminder({
  orderNumber,
  token,
  optedIn,
  remindOn,
  hasEmail,
  notice,
}: {
  orderNumber: string;
  token: string | null;
  optedIn: boolean;
  /** Formatted date the reminder would go, or null. */
  remindOn: string | null;
  hasEmail: boolean;
  notice: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RefillResult | null>(null);
  const [email, setEmail] = useState("");
  const [on, setOn] = useState(optedIn);
  const run = (action: () => Promise<RefillResult>, next: boolean) =>
    start(async () => {
      const r = await action();
      setResult(r);
      if (r.ok) setOn(next);
    });

  return (
    <section className="panel mt-8 p-4" aria-labelledby="refill-heading">
      <h2 id="refill-heading" className="font-display text-lead font-bold">
        {on ? "Refill reminder on" : "Running low later?"}
      </h2>
      {on ? (
        <p className="mt-1 text-small text-ink-soft">
          We&apos;ll email you once{remindOn ? `, around ${remindOn},` : ""} a few days before this runs out, going by the
          daily amount on the pack.{" "}
          <button type="button" className="underline" disabled={pending} onClick={() => run(() => stopRefillReminders(orderNumber, token), false)}>
            Stop reminders
          </button>
        </p>
      ) : (
        <form
          className="mt-2 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => askRefillReminder(orderNumber, token, hasEmail ? null : email), true);
          }}
        >
          <p className="text-small text-ink-soft">
            So a refill arrives in time, we can email you{remindOn ? ` around ${remindOn}` : ""}, a few days before this
            runs out.
          </p>
          {!hasEmail && (
            <div className="max-w-sm">
              <label className="label" htmlFor="refill-email">
                Email for the reminder
              </label>
              <input id="refill-email" type="email" autoComplete="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          )}
          <div>
            <button className="btn btn-outline" disabled={pending}>
              {pending ? "Saving…" : "Remind me before it runs out"}
            </button>
          </div>
          <p className="text-micro text-ink-faint">{notice}</p>
        </form>
      )}
      {result && (
        <p role="status" className="mt-2 text-small" style={{ color: result.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
          {result.message}
        </p>
      )}
    </section>
  );
}
