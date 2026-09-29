/**
 * Small charts for the owner console, drawn on the server as plain HTML and
 * SVG: no chart library, no client JavaScript, nothing for the CSP to allow,
 * and they print. Colours come from the chart tokens in globals.css, so they
 * follow Day and Night.
 *
 * Accessibility: every chart carries its numbers in text as well (labels on
 * the bars, a legend with values, or an sr-only table), so no reading depends
 * on colour or on seeing the drawing.
 */

import Link from "next/link";

export const SERIES = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const;

export const GOOD = "var(--color-chart-good)";
export const BAD = "var(--color-chart-bad)";

export function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <figure className="panel p-4">
      <figcaption className="mb-3">
        <span className="block text-small font-semibold">{title}</span>
        {note && <span className="block text-micro text-ink-faint">{note}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

/** Horizontal bars with their values written on the row. */
export function BarList({
  rows,
  max,
}: {
  rows: readonly { label: string; value: number; display?: string; color?: string }[];
  /** Scale to this instead of the largest value (e.g. 1 for rates). */
  max?: number;
}) {
  const top = max ?? Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-micro text-ink-faint">Nothing to chart yet.</p>;
  return (
    <ul className="grid gap-2">
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3 text-micro">
            <span className="min-w-0 truncate text-ink-soft">{r.label}</span>
            <span className="tabular font-semibold">{r.display ?? r.value.toLocaleString("en-IN")}</span>
          </div>
          <div className="h-2 w-full bg-chart-track" style={{ borderRadius: 2 }}>
            <div
              className="h-2"
              style={{
                width: `${top > 0 ? Math.max(1, (r.value / top) * 100) : 0}%`,
                background: r.color ?? SERIES[0],
                borderRadius: 2,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One bar split into parts, with a legend that carries the numbers. */
export function StackedBar({ parts }: { parts: readonly { label: string; value: number; color?: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <p className="text-micro text-ink-faint">Nothing to chart yet.</p>;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden bg-chart-track" style={{ borderRadius: 2 }} aria-hidden>
        {parts.map((p, i) =>
          p.value > 0 ? <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color ?? SERIES[i % SERIES.length] }} /> : null,
        )}
      </div>
      <Legend items={parts.map((p, i) => ({ label: p.label, color: p.color ?? SERIES[i % SERIES.length], value: `${p.value.toLocaleString("en-IN")} · ${Math.round((p.value / total) * 100)}%` }))} />
    </div>
  );
}

export function Legend({ items }: { items: readonly { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-micro">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5" style={{ background: item.color, borderRadius: 2 }} />
          <span className="text-ink-soft">{item.label}</span>
          {item.value && <span className="tabular font-semibold">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Ring chart for a share-of-total, legend beside it. */
export function Donut({ parts, centre }: { parts: readonly { label: string; value: number; color?: string }[]; centre?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <p className="text-micro text-ink-faint">Nothing to chart yet.</p>;
  const r = 15.9155; // circumference of 100, so dash lengths are percentages
  const shares = parts.map((p) => (p.value / total) * 100);
  // Each arc starts where the previous ones end, from twelve o'clock.
  const offsets = shares.map((_, i) => 25 - shares.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 42 42" className="h-28 w-28 shrink-0" aria-hidden>
        <circle cx="21" cy="21" r={r} fill="none" stroke="var(--color-chart-track)" strokeWidth="6" />
        {parts.map((p, i) => (
          <circle
            key={p.label}
            cx="21"
            cy="21"
            r={r}
            fill="none"
            stroke={p.color ?? SERIES[i % SERIES.length]}
            strokeWidth="6"
            strokeDasharray={`${shares[i]} ${100 - shares[i]}`}
            strokeDashoffset={offsets[i]}
          />
        ))}
        {centre && (
          <text x="21" y="23" textAnchor="middle" fontSize="7" fontWeight="700" fill="var(--color-ink)">
            {centre}
          </text>
        )}
      </svg>
      <ul className="grid gap-1 text-micro">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5" style={{ background: p.color ?? SERIES[i % SERIES.length], borderRadius: 2 }} />
            <span className="text-ink-soft">{p.label}</span>
            <span className="tabular font-semibold">
              {p.value.toLocaleString("en-IN")} · {Math.round((p.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A line over time. Gaps (null) break the line rather than dropping to zero,
 * so a day with no attempts doesn't read as a 0% success rate.
 */
export function TrendLine({
  points,
  format = (v) => v.toLocaleString("en-IN"),
  color = SERIES[1],
  min,
  max,
  height = 96,
}: {
  points: readonly { label: string; value: number | null }[];
  format?: (v: number) => string;
  color?: string;
  min?: number;
  max?: number;
  height?: number;
}) {
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length === 0) return <p className="text-micro text-ink-faint">Nothing to chart yet.</p>;
  const lo = min ?? Math.min(0, ...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  const w = 100;
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const y = (v: number) => 38 - ((v - lo) / span) * 36;
  // Split into runs of consecutive known values.
  const runs: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length) runs.push(current.join(" "));
      current = [];
    } else current.push(`${(i * step).toFixed(2)},${y(p.value).toFixed(2)}`);
  });
  if (current.length) runs.push(current.join(" "));
  const last = [...points].reverse().find((p) => p.value !== null);
  return (
    <div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden>
        <line x1="0" y1="38" x2="100" y2="38" stroke="var(--color-rule)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        {runs.map((run, i) =>
          run.includes(" ") ? (
            <polyline key={i} points={run} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ) : (
            <circle key={i} cx={run.split(",")[0]} cy={run.split(",")[1]} r="1.2" fill={color} />
          ),
        )}
      </svg>
      <div className="mt-1 flex justify-between text-micro text-ink-faint tabular">
        <span>{points[0]?.label}</span>
        {last && (
          <span className="text-ink">
            Latest: <strong>{format(last.value!)}</strong>
          </span>
        )}
        <span>{points[points.length - 1]?.label}</span>
      </div>
      <table className="sr-only">
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <th scope="row">{p.label}</th>
              <td>{p.value === null ? "no data" : format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Vertical bars per period (orders per day, per hour). */
export function Columns({
  points,
  color = SERIES[0],
  height = 88,
  format = (v) => v.toLocaleString("en-IN"),
}: {
  points: readonly { label: string; value: number }[];
  color?: string;
  height?: number;
  format?: (v: number) => string;
}) {
  const top = Math.max(0, ...points.map((p) => p.value));
  if (top === 0) return <p className="text-micro text-ink-faint">Nothing to chart yet.</p>;
  return (
    <div>
      <div className="flex items-end gap-px" style={{ height }} aria-hidden>
        {points.map((p) => (
          <div key={p.label} className="flex-1" title={`${p.label}: ${format(p.value)}`} style={{ height: `${(p.value / top) * 100}%`, minHeight: p.value > 0 ? 2 : 0, background: color }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-micro text-ink-faint tabular">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
      <table className="sr-only">
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <th scope="row">{p.label}</th>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A grid of cells shaded by value (cohort retention, orders by hour and
 * weekday). The value is printed in every cell; the shading only helps the
 * eye find the pattern. Shading stops at 45% so the text keeps its contrast.
 */
export function HeatGrid({
  rows,
  columns,
  format,
  caption,
}: {
  rows: readonly { label: string; sub?: string; cells: readonly (number | null)[] }[];
  columns: readonly string[];
  format: (v: number) => string;
  caption: string;
}) {
  const values = rows.flatMap((r) => r.cells).filter((v): v is number => v !== null);
  const top = Math.max(0, ...values);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-micro tabular">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="p-1 text-left font-semibold text-ink-soft" />
            {columns.map((c) => (
              <th key={c} scope="col" className="p-1 text-center font-semibold text-ink-soft">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="whitespace-nowrap p-1 text-left font-semibold">
                {row.label}
                {row.sub && <span className="block font-normal text-ink-faint">{row.sub}</span>}
              </th>
              {row.cells.map((v, i) => (
                <td
                  key={i}
                  className="border border-rule p-1 text-center"
                  style={
                    v !== null && top > 0
                      ? { background: `color-mix(in srgb, var(--color-chart-2) ${Math.round((v / top) * 45)}%, var(--color-surface))` }
                      : undefined
                  }
                >
                  {v === null ? <span className="text-ink-faint">·</span> : format(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A number with its label: the tiles at the top of each report. */
export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="panel p-4">
      <p className="text-micro text-ink-faint">{label}</p>
      <p className={`tabular text-lead font-bold ${tone === "bad" ? "text-alert" : ""}`}>{value}</p>
      {sub && <p className="mt-1 text-micro text-ink-faint">{sub}</p>}
    </div>
  );
}

/** Pager for the 10-item rule: numbered sub-pages, links only (no client code). */
export function Pager({ page, pages, href, label = "Pages" }: { page: number; pages: number; href: (p: number) => string; label?: string }) {
  if (pages <= 1) return null;
  const shown = Array.from({ length: pages }, (_, i) => i + 1).filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 2);
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1 text-small">
      {page > 1 && (
        <Link href={href(page - 1)} className="px-2 py-1 underline">
          Previous
        </Link>
      )}
      {shown.map((p, i) => (
        <span key={p} className="flex items-center">
          {i > 0 && shown[i - 1] !== p - 1 && <span className="px-1 text-ink-faint">…</span>}
          {p === page ? (
            <span aria-current="page" className="bg-inverse px-2.5 py-1 font-semibold text-on-inverse tabular" style={{ borderRadius: 2 }}>
              {p}
            </span>
          ) : (
            <Link href={href(p)} className="px-2.5 py-1 underline tabular">
              {p}
            </Link>
          )}
        </span>
      ))}
      {page < pages && (
        <Link href={href(page + 1)} className="px-2 py-1 underline">
          Next
        </Link>
      )}
      <span className="ml-2 text-micro text-ink-faint">10 per page</span>
    </nav>
  );
}
