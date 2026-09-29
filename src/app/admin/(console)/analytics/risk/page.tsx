import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import { Empty, NoAccess } from "@/components/ui";
import { BarList, ChartCard, Pager, StackedBar, Stat, SERIES, BAD } from "@/components/charts";
import { INTEL_PAGE_SIZE, pageCount, pageOf, parsePage } from "@/lib/intel/paging";
import { BAND_ACTION, RISK_BANDS, riskBand, type RiskBand } from "@/lib/intel/rto-risk";
import { riskQueue } from "@/server/intel-reports";
import { ist, reportHref } from "../format";

export const dynamic = "force-dynamic";

const BAND_LABEL: Record<RiskBand, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", VERY_HIGH: "Very high" };
const BAND_COLOR: Record<RiskBand, string> = { LOW: SERIES[2], MEDIUM: SERIES[0], HIGH: SERIES[3], VERY_HIGH: BAD };
const BANDS: RiskBand[] = ["VERY_HIGH", "HIGH", "MEDIUM", "LOW"];

/**
 * Orders waiting to ship, riskiest first: who to confirm with before packing.
 * Fulfilment can see it too (orders:view), since they're the ones calling.
 */
export default async function RiskPage({ searchParams }: { searchParams: Promise<{ band?: string; page?: string }> }) {
  const session = await requirePermission("orders:view");
  if (!session) return <NoAccess />;
  const params = await searchParams;
  const queue = await riskQueue();
  const band = BANDS.find((b) => b === params.band) ?? null;
  const listed = band ? queue.filter((o) => riskBand(o.score) === band) : queue;
  const page = parsePage(params.page, listed.length);
  const shown = pageOf(listed, page);
  const count = (b: RiskBand) => queue.filter((o) => riskBand(o.score) === b).length;
  const codValueAtRisk = queue.filter((o) => o.cod && o.score >= RISK_BANDS.high).reduce((s, o) => s + o.totalPaise, 0);

  const reasons = new Map<string, number>();
  for (const o of shown) for (const r of o.reasons) if (r.points > 0) reasons.set(r.label.replace(/^\d+ /, "N "), (reasons.get(r.label.replace(/^\d+ /, "N ")) ?? 0) + 1);

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">RTO risk</h1>
        <p className="mt-1 max-w-[72ch] text-small text-ink-soft">
          Orders not yet shipped, scored 0–100 for the chance the parcel comes back undelivered (return to origin). Every score
          shows its reasons, so you can decide: confirm by message, call, or ask for prepayment. Rules, not a black box; see
          docs/INTELLIGENCE.md.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Waiting to ship" value={String(queue.length)} />
        {BANDS.map((b) => (
          <Stat key={b} label={`${BAND_LABEL[b]} risk`} value={String(count(b))} sub={BAND_ACTION[b]} tone={b === "VERY_HIGH" && count(b) > 0 ? "bad" : undefined} />
        ))}
      </section>
      {codValueAtRisk > 0 && (
        <p className="text-small">
          <strong>{formatINR(codValueAtRisk)}</strong> of cash on delivery orders are high or very high risk.
        </p>
      )}

      <nav aria-label="Risk band" className="flex flex-wrap gap-2 text-small">
        <Link href="/admin/analytics/risk" className={`border px-2.5 py-1 ${!band ? "border-strong font-semibold" : "border-rule text-ink-soft"}`} style={{ borderRadius: 2 }}>
          All <span className="tabular">{queue.length}</span>
        </Link>
        {BANDS.map((b) => (
          <Link key={b} href={reportHref("/admin/analytics/risk", { band: b })} className={`border px-2.5 py-1 ${band === b ? "border-strong font-semibold" : "border-rule text-ink-soft"}`} style={{ borderRadius: 2 }}>
            {BAND_LABEL[b]} <span className="tabular">{count(b)}</span>
          </Link>
        ))}
      </nav>

      {listed.length === 0 ? (
        <Empty title="Nothing waiting here" detail="Orders appear once placed and leave once shipped." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
          <div className="grid gap-3">
            <p className="text-micro text-ink-faint">
              Showing {(page - 1) * INTEL_PAGE_SIZE + 1}–{Math.min(page * INTEL_PAGE_SIZE, listed.length)} of {listed.length}, riskiest first
            </p>
            {shown.map((o) => {
              const b = riskBand(o.score);
              return (
                <div key={o.id} className="panel">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2.5">
                    <Link href={`/admin/orders/${o.id}`} className="font-semibold tabular underline">{o.orderNumber}</Link>
                    <span className="text-small">
                      <span className="tabular font-bold" style={{ color: b === "VERY_HIGH" || b === "HIGH" ? "var(--color-alert)" : undefined }}>{o.score}</span>
                      <span className="text-ink-soft"> · {BAND_LABEL[b]}</span>
                    </span>
                  </div>
                  <div className="grid gap-1 px-4 py-2.5 text-small">
                    <p className="text-micro tabular text-ink-soft">
                      {o.name} · {o.pincode ?? "—"} · {o.cod ? "Cash on delivery" : "Paid online"} · {formatINR(o.totalPaise)} · {ist.format(o.placedAt)}
                      {o.computed && " · scored now"}
                    </p>
                    <p className="font-semibold">{BAND_ACTION[b]}</p>
                    <ul className="grid gap-0.5 text-micro">
                      {o.reasons.map((r) => (
                        <li key={r.code} className={r.points < 0 ? "text-ink-soft" : ""}>
                          <span className="tabular">{r.points > 0 ? `+${r.points}` : r.points}</span> {r.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
            <Pager page={page} pages={pageCount(listed.length)} href={(n) => reportHref("/admin/analytics/risk", { band: band ?? undefined, page: n === 1 ? undefined : n })} />
          </div>
          <div className="grid gap-4">
            <ChartCard title="Scores" note="These orders">
              <BarList max={100} rows={shown.map((o) => ({ label: `${o.orderNumber} · ${o.name}`, value: o.score, color: BAND_COLOR[riskBand(o.score)] }))} />
            </ChartCard>
            <ChartCard title="Bands">
              <StackedBar parts={BANDS.map((b) => ({ label: BAND_LABEL[b], value: shown.filter((o) => riskBand(o.score) === b).length, color: BAND_COLOR[b] }))} />
            </ChartCard>
            <ChartCard title="Most common reasons" note="Among these orders">
              <BarList rows={[...reasons.entries()].sort((a, c) => c[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value, color: SERIES[3] }))} />
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}
