import { requirePermission } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import { NoAccess } from "@/components/ui";
import { BarList, ChartCard, Donut, Pager, StackedBar, Stat, TrendLine, SERIES, BAD } from "@/components/charts";
import { pageCount, pageOf, parsePage, INTEL_PAGE_SIZE } from "@/lib/intel/paging";
import { METHOD_LABEL, customerCaused, overallStatus, type HealthStatus } from "@/lib/intel/payment-health";
import { onlinePaymentsEnabled } from "@/lib/payments-config";
import { paymentReport } from "@/server/intel-reports";
import { ist, pct, reportHref } from "../format";
import { AutoRefresh } from "./auto-refresh";

export const dynamic = "force-dynamic";

const STATUS: Record<HealthStatus, { label: string; className: string }> = {
  OK: { label: "Healthy", className: "text-ink" },
  DEGRADED: { label: "Degraded", className: "text-alert" },
  DOWN: { label: "Down", className: "text-alert" },
  LOW_DATA: { label: "Too few attempts to judge", className: "text-ink-soft" },
};

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await requirePermission("finance:view");
  if (!session) return <NoAccess />;
  const params = await searchParams;
  const now = new Date();
  const report = await paymentReport(now);
  const headline = overallStatus(report.health);
  // Razorpay's own notices, and the owner's "steer shoppers away" notes (ids starting owner:).
  const active = report.downtimes.filter((d) => d.status !== "resolved" && !d.id.startsWith("owner:"));
  const steering = report.downtimes.filter((d) => d.status !== "resolved" && d.id.startsWith("owner:"));

  const failures = report.failures;
  const page = parsePage(params.page, failures.length);
  const shown = pageOf(failures, page);
  const reasonCounts = new Map<string, number>();
  for (const f of shown) reasonCounts.set(f.errorReason ?? "No reason given", (reasonCounts.get(f.errorReason ?? "No reason given") ?? 0) + 1);
  const methodCounts = new Map<string, number>();
  for (const f of shown) methodCounts.set(METHOD_LABEL[f.method ?? "unknown"] ?? f.method ?? "—", (methodCounts.get(METHOD_LABEL[f.method ?? "unknown"] ?? f.method ?? "—") ?? 0) + 1);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h2 font-extrabold">Payments</h1>
          <p className="mt-1 max-w-[70ch] text-small text-ink-soft">
            Whether each way to pay is working as usual. Failures a shopper caused (a cancelled UPI request, a wrong OTP) are left
            out of the health check, so they can&apos;t look like an outage.
          </p>
        </div>
        <AutoRefresh seconds={60} />
      </div>

      {!onlinePaymentsEnabled() && (
        <p className="border-l-4 border-caution bg-shelf px-4 py-3 text-small">
          Online payment isn&apos;t set up on this deployment, so no new attempts are coming in. Figures below are from recorded history.
        </p>
      )}

      {steering.length > 0 && (
        <p className="border-l-4 border-caution bg-shelf px-4 py-3 text-small" role="status">
          You&apos;re steering shoppers away from {steering.map((d) => METHOD_LABEL[d.method] ?? d.method).join(" and ")}: checkout notes it and selects
          another way to pay first. Clear it from the insight on the Overview when it recovers.
        </p>
      )}

      {active.length > 0 && (
        <div className="border-l-4 border-alert bg-shelf px-4 py-3 text-small" role="status">
          <p className="font-semibold">Razorpay reports {active.length === 1 ? "an outage" : `${active.length} outages`} right now</p>
          <ul className="mt-1 grid gap-0.5">
            {active.map((d) => (
              <li key={d.id}>
                {METHOD_LABEL[d.method] ?? d.method} · {d.severity} severity · since {ist.format(d.beginAt)}
                {d.instrument ? ` · ${Object.values(d.instrument as Record<string, unknown>).filter((v) => typeof v === "string").join(", ")}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-ink-soft">Checkout tells shoppers to pick another way to pay while it lasts.</p>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Payments overall" value={STATUS[headline].label} tone={headline === "DOWN" || headline === "DEGRADED" ? "bad" : undefined} />
        <Stat
          label="Online orders paid, 30 days"
          value={pct(report.online.orders ? report.online.completed / report.online.orders : null)}
          sub={`${report.online.completed} of ${report.online.orders} · ${report.dismissals} payment windows closed unpaid`}
        />
        <Stat label="COD orders delivered, 30 days" value={String(report.cod.delivered)} sub={`${report.cod.orders} placed · ${report.cod.rto} returned to origin`} />
        <Stat label="COD never confirmed" value={String(report.cod.unconfirmed)} sub="Cancelled: the shopper couldn't be reached" />
      </section>

      <section className="grid gap-4">
        <h2 className="text-h3 font-bold">Health by method</h2>
        {report.health.length === 0 ? (
          <p className="text-small text-ink-soft">No online payment attempts in the last 30 days.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {report.health.map((m) => (
              <ChartCard key={m.method} title={`${m.label}: ${STATUS[m.status].label}`} note={m.why}>
                <p className="mb-2 text-micro tabular text-ink-soft">
                  Recent: {m.recent.captured}/{m.recent.attempts} succeeded ({pct(m.recent.rate)}
                  {m.interval ? `, likely ${pct(m.interval.low)}–${pct(m.interval.high)}` : ""}) · usual {pct(m.baseline)}
                  {m.baselineFrom === "norm" ? " (industry norm until there's history)" : " (last 28 days)"}
                  {m.attemptRate.attempts > m.recent.attempts && ` · ${m.attemptRate.attempts - m.recent.attempts} shopper-caused failures left out`}
                </p>
                <TrendLine
                  min={0}
                  max={1}
                  color={m.status === "DOWN" || m.status === "DEGRADED" ? BAD : SERIES[1]}
                  format={(v) => pct(v)}
                  points={m.daily.map((v, i) => ({ label: i === m.daily.length - 1 ? "Today" : `${m.daily.length - 1 - i}d ago`, value: v }))}
                />
                {m.topErrors.length > 0 && (
                  <ul className="mt-2 grid gap-0.5 text-micro text-ink-soft">
                    {m.topErrors.map((e) => (
                      <li key={e.reason}>
                        {e.count} × {e.reason}
                        {e.customer ? " (shopper)" : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </ChartCard>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Online orders paid, per day" note="Share of online orders that were paid, last 30 days">
          <TrendLine min={0} max={1} format={(v) => pct(v)} points={report.online.perDay} color={SERIES[2]} />
        </ChartCard>
        <ChartCard title="What shoppers chose at checkout" note="Payment option selected, last 30 days">
          <Donut parts={report.chosen.map((c, i) => ({ label: c.method === "RAZORPAY" ? "Net banking / other" : c.method, value: c.count, color: SERIES[i % SERIES.length] }))} />
        </ChartCard>
      </section>

      <section className="grid gap-4">
        <h2 className="text-h3 font-bold">Recent failed payments</h2>
        {failures.length === 0 ? (
          <p className="text-small text-ink-soft">No failed payments in the last 30 days.</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
            <div className="grid gap-3">
              <p className="text-micro text-ink-faint">
                Showing {(page - 1) * INTEL_PAGE_SIZE + 1}–{Math.min(page * INTEL_PAGE_SIZE, failures.length)} of {failures.length}, newest first
              </p>
              <div className="panel">
                {shown.map((f) => (
                  <div key={f.id} className="grid gap-0.5 border-b border-rule px-4 py-2.5 text-small last:border-b-0">
                    <p>
                      <span className="font-semibold">{METHOD_LABEL[f.method ?? "unknown"] ?? f.method}</span>
                      <span className="text-ink-soft"> · {f.errorReason ?? "No reason given"}</span>
                      {customerCaused(f) && <span className="text-ink-faint"> · caused by shopper</span>}
                    </p>
                    <p className="text-micro tabular text-ink-faint">
                      {ist.format(f.createdAt)}
                      {f.amountPaise != null && ` · ${formatINR(f.amountPaise)}`}
                      {f.errorSource && ` · source: ${f.errorSource}`}
                    </p>
                  </div>
                ))}
              </div>
              <Pager page={page} pages={pageCount(failures.length)} href={(p) => reportHref("/admin/analytics/payments", { page: p === 1 ? undefined : p })} />
            </div>
            <div className="grid gap-4">
              <ChartCard title="Why these failed">
                <BarList rows={[...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, color: BAD }))} />
              </ChartCard>
              <ChartCard title="Who caused them">
                <StackedBar
                  parts={[
                    { label: "Bank or gateway", value: shown.filter((f) => !customerCaused(f)).length, color: BAD },
                    { label: "Shopper", value: shown.filter((f) => customerCaused(f)).length, color: SERIES[4] },
                  ]}
                />
              </ChartCard>
              <ChartCard title="By method">
                <BarList rows={[...methodCounts.entries()].map(([label, value], i) => ({ label, value, color: SERIES[i % SERIES.length] }))} />
              </ChartCard>
              <p className="text-micro text-ink-faint">Charts cover only the ten failures on this page.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
