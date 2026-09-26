import { formatDate } from "@/lib/format";
import type { OrderProgress } from "@/lib/order-progress";

/**
 * Placed → Packing → Shipped → Delivered, with dates. Cuts down "where is my
 * order" calls, which come disproportionately from cash-on-delivery buyers.
 */
export function OrderTracker({ progress }: { progress: OrderProgress }) {
  return (
    <section className="panel mt-8" aria-labelledby="tracker-title">
      <h2 id="tracker-title" className="panel-head">Order progress</h2>
      <ol className="grid gap-0 p-3.5 sm:grid-cols-4 sm:gap-2">
        {progress.stages.map((s, i) => (
          <li key={s.key} className="flex gap-3 sm:flex-col sm:gap-2" aria-current={s.current ? "step" : undefined}>
            <div className="flex flex-col items-center sm:flex-row">
              <span
                aria-hidden
                className={`grid h-6 w-6 shrink-0 place-items-center text-micro font-bold ${s.done ? "bg-ink text-paper" : "border border-rule text-ink-faint"}`}
                style={{ borderRadius: 999 }}
              >
                {s.done ? "✓" : i + 1}
              </span>
              {i < progress.stages.length - 1 && (
                <span aria-hidden className={`h-6 w-px sm:h-px sm:w-full ${progress.stages[i + 1].done ? "bg-ink" : "bg-rule"}`} />
              )}
            </div>
            <div className="pb-3 sm:pb-0">
              <p className={`text-small ${s.current ? "font-bold" : s.done ? "font-semibold" : "text-ink-faint"}`}>
                {s.label}
                <span className="sr-only">{s.done ? " (done)" : " (not yet)"}</span>
              </p>
              {s.date && <p className="text-micro text-ink-faint">{formatDate(s.date)}</p>}
            </div>
          </li>
        ))}
      </ol>
      {progress.ended && (
        <p className="border-t border-rule px-3.5 py-3 text-small">
          <span className="font-semibold">{progress.ended.label}</span>
          {progress.ended.date && <span className="text-ink-faint"> · {formatDate(progress.ended.date)}</span>}
        </p>
      )}
      {progress.tracking && (
        <p className="border-t border-rule px-3.5 py-3 text-small">
          Tracking number <span className="tabular font-semibold select-all">{progress.tracking.number}</span>
          {progress.tracking.courier && <span className="text-ink-soft"> · {progress.tracking.courier}</span>}
        </p>
      )}
    </section>
  );
}
