"use client";

import { useState, useTransition } from "react";
import { sendDigestTest, setDailyDigest, type MessageActionResult } from "./actions";

/** The owner's daily summary email: on or off, and send one now to see it (src/server/digest.ts). */
export function DigestPanel({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<MessageActionResult | null>(null);
  return (
    <section className="panel p-4" aria-labelledby="digest-heading">
      <h2 id="digest-heading" className="font-display text-lead font-bold">
        Daily summary email
      </h2>
      <p className="mt-1 max-w-[68ch] text-small text-ink-soft">
        Each morning at 8 am: what needs doing today, yesterday&apos;s sales against the same day last week, and the Copilot&apos;s top
        insights, each with a link into the console. To your alert address.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-small">
          <input
            type="checkbox"
            checked={on}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.checked;
              start(async () => {
                const r = await setDailyDigest(next);
                setResult(r);
                if (r.ok) setOn(next);
              });
            }}
          />
          Send it every morning
        </label>
        <button type="button" className="btn btn-outline px-3 py-1.5 text-small" disabled={pending || !on} onClick={() => start(async () => setResult(await sendDigestTest()))}>
          {pending ? "Working…" : "Send today's now"}
        </button>
        {result && (
          <span role="status" className={`text-small ${result.ok ? "text-veg" : "text-alert"}`}>
            {result.message}
          </span>
        )}
      </div>
    </section>
  );
}
