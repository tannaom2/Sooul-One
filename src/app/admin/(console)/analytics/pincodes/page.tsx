import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatINR } from "@/lib/money";
import { Empty, NoAccess } from "@/components/ui";
import { BarList, ChartCard, Pager, StackedBar, Stat, SERIES, BAD, GOOD } from "@/components/charts";
import { INTEL_PAGE_SIZE, pageCount, pageOf, parsePage } from "@/lib/intel/paging";
import { pincodeReport, type PincodeRow, type PincodeSort } from "@/server/intel-reports";
import { ActionForm } from "../../boxes/action-form";
import { savePincodeRule } from "../actions";
import { days, parseDays, pct, reportHref } from "../format";

export const dynamic = "force-dynamic";

const SORTS: Record<PincodeSort, string> = { orders: "Most orders", rto: "Most returned (COD)", slow: "Slowest delivery", revenue: "Most revenue" };

function CodBadge({ row }: { row: PincodeRow }) {
  if (row.rule?.codBlocked) return <span className="font-semibold text-alert">COD off (your rule)</span>;
  if (row.rule?.codAllowed) return <span className="font-semibold">COD on (your rule)</span>;
  if (row.autoBlocked) return <span className="font-semibold text-alert">COD off (automatic)</span>;
  return <span className="text-ink-soft">COD on</span>;
}

function RuleForm({ pincode, row }: { pincode: string; row: PincodeRow | null }) {
  const mode = row?.rule?.codBlocked ? "BLOCK" : row?.rule?.codAllowed ? "ALLOW" : "AUTO";
  return (
    <ActionForm action={savePincodeRule} submitLabel="Save rule" className="grid gap-3 p-3 sm:grid-cols-3">
      <input type="hidden" name="pincode" value={pincode} />
      <label className="grid gap-1 text-small">
        <span className="label">Cash on delivery</span>
        <select name="cod" className="field" defaultValue={mode}>
          <option value="AUTO">Follow store settings</option>
          <option value="BLOCK">Off for this pincode</option>
          <option value="ALLOW">Always on for this pincode</option>
        </select>
      </label>
      <label className="grid gap-1 text-small">
        <span className="label">Extra delivery days</span>
        <input name="extraDays" type="number" min={0} max={14} className="field" defaultValue={row?.rule?.extraDays ?? 0} />
      </label>
      <label className="grid gap-1 text-small">
        <span className="label">Note (optional)</span>
        <input name="note" className="field" maxLength={200} defaultValue={row?.rule?.note ?? ""} placeholder="Why" />
      </label>
    </ActionForm>
  );
}

export default async function PincodesPage({ searchParams }: { searchParams: Promise<{ days?: string; sort?: string; page?: string; q?: string }> }) {
  const session = await requirePermission("finance:view");
  if (!session) return <NoAccess />;
  const canEdit = can(session.role, "settings:manage");
  const params = await searchParams;
  const windowDays = parseDays(params.days);
  const sort: PincodeSort = params.sort && params.sort in SORTS ? (params.sort as PincodeSort) : "orders";
  const report = await pincodeReport(windowDays, sort);
  const q = params.q && /^\d{6}$/.test(params.q) ? params.q : null;
  const rows = q ? report.rows.filter((r) => r.pincode === q) : report.rows;
  const page = parsePage(params.page, rows.length);
  const pages = pageCount(rows.length);
  const shown = pageOf(rows, page);
  const href = (p: Record<string, string | number | undefined>) =>
    reportHref("/admin/analytics/pincodes", { days: windowDays === 90 ? undefined : windowDays, sort: sort === "orders" ? undefined : sort, q: q ?? undefined, ...p });
  const t = report.totals;
  const s = report.settings;

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h2 font-extrabold">Pincodes</h1>
          <p className="mt-1 max-w-[70ch] text-small text-ink-soft">
            How orders to each pincode turn out: delivered or returned to origin (RTO), how fast, and how people pay. Cash on delivery
            can be switched off per pincode here; store-wide COD rules are in{" "}
            <Link href="/admin/controls" className="underline">Store controls</Link>.
          </p>
        </div>
        <div className="flex items-center gap-3 text-small">
          <span className="text-ink-faint">Last</span>
          {[30, 90, 365].map((d) => (
            <Link key={d} href={reportHref("/admin/analytics/pincodes", { days: d === 90 ? undefined : d, sort: sort === "orders" ? undefined : sort })} className={d === windowDays ? "font-semibold underline" : "text-ink-soft hover:underline"}>
              {d} days
            </Link>
          ))}
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Pincodes ordering" value={String(t.pincodes)} sub={`${t.orders} orders`} />
        <Stat label="Delivered, of parcels that finished" value={pct(t.successRate)} tone={t.successRate !== null && t.successRate < 0.85 ? "bad" : undefined} />
        <Stat label="COD returned to origin" value={pct(t.codRtoRate, 1)} sub={`Store baseline ${pct(report.baseline, 1)}, all time`} tone={t.codRtoRate !== null && t.codRtoRate > 0.2 ? "bad" : undefined} />
        <Stat label="Cash on delivery share" value={pct(t.codShare)} />
        <Stat label="Order to doorstep" value={days(t.avgDeliveryDays)} sub="Average, delivered orders" />
      </section>

      <p className="text-small text-ink-soft">
        Automatic COD switch-off:{" "}
        {s.codAutoBlock ? (
          <strong>on, at {s.codAutoBlockRtoPercent}% returned out of {s.codAutoBlockMinShipped}+ COD parcels</strong>
        ) : (
          <strong>off</strong>
        )}
        {s.codMinOrderValue != null && <> · COD from ₹{s.codMinOrderValue.toLocaleString("en-IN")}</>}
        {s.codMaxOrderValue != null && <> · COD up to ₹{s.codMaxOrderValue.toLocaleString("en-IN")}</>}
      </p>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav aria-label="Sort" className="flex flex-wrap gap-3 text-small">
          {(Object.keys(SORTS) as PincodeSort[]).map((k) => (
            <Link key={k} href={reportHref("/admin/analytics/pincodes", { days: windowDays === 90 ? undefined : windowDays, sort: k === "orders" ? undefined : k })} className={k === sort ? "font-semibold underline" : "text-ink-soft hover:underline"}>
              {SORTS[k]}
            </Link>
          ))}
        </nav>
        <form method="get" className="flex items-end gap-2">
          {windowDays !== 90 && <input type="hidden" name="days" value={windowDays} />}
          <label className="text-small">
            <span className="label">Find or add a pincode</span>
            <input name="q" inputMode="numeric" maxLength={6} pattern="\d{6}" defaultValue={q ?? ""} className="field w-32" />
          </label>
          <button className="btn btn-outline px-3 py-2 text-small">Go</button>
          {q && <Link href={href({ q: undefined, page: undefined })} className="pb-2 text-small underline">Clear</Link>}
        </form>
      </div>

      {q && rows.length === 0 ? (
        <div className="panel">
          <div className="panel-head">{q}: no orders yet</div>
          {canEdit ? <RuleForm pincode={q} row={null} /> : <p className="p-3 text-small text-ink-soft">Only the owner can set rules.</p>}
        </div>
      ) : rows.length === 0 ? (
        <Empty title="No orders in this window" detail="Pincode figures appear once orders are placed." />
      ) : (
        // The 10-item rule: ten pincodes on the left, charts of exactly those ten on the right.
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
          <div className="grid gap-3">
            <p className="text-micro text-ink-faint">
              Showing {(page - 1) * INTEL_PAGE_SIZE + 1}–{Math.min(page * INTEL_PAGE_SIZE, rows.length)} of {rows.length} · {SORTS[sort]}
            </p>
            {shown.map((r) => (
              <details key={r.pincode} className="panel" open={Boolean(q)}>
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3">
                  <span>
                    <span className="tabular font-semibold">{r.pincode}</span>
                    <span className="ml-2 text-small text-ink-soft">{r.city ?? ""}</span>
                  </span>
                  <span className="text-micro"><CodBadge row={r} /></span>
                  <span className="w-full text-micro tabular text-ink-soft">
                    {r.orders} orders · {pct(r.successRate)} delivered · COD RTO {pct(r.codRtoRate)} ({r.codReturned}/{r.codFinished}) · COD {pct(r.codShare)} ·{" "}
                    {days(r.avgDeliveryDays)} · on time {pct(r.onTimeRate)} · {formatINR(r.revenuePaise)}
                    {r.rule?.extraDays ? ` · +${r.rule.extraDays} days promised` : ""}
                  </span>
                </summary>
                <div className="border-t border-rule">
                  {r.rule?.note && <p className="px-3 pt-3 text-micro text-ink-soft">Note: {r.rule.note}</p>}
                  {canEdit ? <RuleForm pincode={r.pincode} row={r} /> : <p className="p-3 text-small text-ink-soft">Only the owner can set rules.</p>}
                </div>
              </details>
            ))}
            <Pager page={page} pages={pages} href={(p) => href({ page: p === 1 ? undefined : p })} />
          </div>

          <div className="grid gap-4">
            <ChartCard title="COD returned to origin" note="These pincodes · finished COD parcels">
              <BarList
                max={1}
                rows={shown.map((r) => ({
                  label: `${r.pincode} ${r.city ?? ""}`,
                  value: r.codRtoRate ?? 0,
                  display: r.codFinished ? `${pct(r.codRtoRate)} (${r.codReturned}/${r.codFinished})` : "no COD yet",
                  color: (r.codRtoRate ?? 0) >= Math.max(0.2, report.baseline * 2) ? BAD : SERIES[0],
                }))}
              />
            </ChartCard>
            <ChartCard title="Order to doorstep" note="Average days, these pincodes">
              <BarList rows={shown.map((r) => ({ label: `${r.pincode} ${r.city ?? ""}`, value: r.avgDeliveryDays ?? 0, display: days(r.avgDeliveryDays), color: SERIES[1] }))} />
            </ChartCard>
            <ChartCard title="How these pincodes pay">
              <StackedBar
                parts={[
                  { label: "Cash on delivery", value: shown.reduce((s, r) => s + r.codOrders, 0), color: SERIES[0] },
                  { label: "Prepaid", value: shown.reduce((s, r) => s + r.orders - r.codOrders, 0), color: SERIES[2] },
                ]}
              />
            </ChartCard>
            <ChartCard title="How their parcels ended">
              <StackedBar
                parts={[
                  { label: "Delivered", value: shown.reduce((s, r) => s + r.delivered, 0), color: GOOD },
                  { label: "Returned to origin", value: shown.reduce((s, r) => s + r.rto, 0), color: BAD },
                  { label: "Returned by customer", value: shown.reduce((s, r) => s + r.returned, 0), color: SERIES[3] },
                  { label: "Cancelled", value: shown.reduce((s, r) => s + r.cancelled, 0), color: SERIES[4] },
                ]}
              />
            </ChartCard>
          </div>
        </div>
      )}

      <section className="grid gap-4">
        <div>
          <h2 className="text-h3 font-bold">Demand from pincodes typed at checkout</h2>
          <p className="mt-1 max-w-[70ch] text-small text-ink-soft">
            {report.demand.checks} pincode checks in the last {windowDays} days, {report.demand.outsideChecks} of them from outside the
            delivery area: a guide to where to deliver next.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Outside the delivery area, by region" note="Pincode checks">
            <BarList rows={report.demand.outsideRegions.map((r) => ({ label: r.region, value: r.checks, color: SERIES[3] }))} />
          </ChartCard>
          <ChartCard title="Most-asked pincodes we don't deliver to">
            <BarList rows={report.demand.topOutside.map((d) => ({ label: d.pincode, value: d.checks, color: SERIES[4] }))} />
          </ChartCard>
        </div>
      </section>
    </div>
  );
}
