import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatINR } from "@/lib/money";
import { maskMobile } from "@/lib/mobile";
import { Empty, NoAccess } from "@/components/ui";
import { BarList, ChartCard, Donut, HeatGrid, Pager, Stat, SERIES, BAD } from "@/components/charts";
import { INTEL_PAGE_SIZE, pageCount, pageOf, parsePage } from "@/lib/intel/paging";
import { SEGMENT_ACTION, monthKey, type Segment } from "@/lib/intel/customers";
import { customerData } from "@/server/intel-reports";
import { ActionForm } from "../../boxes/action-form";
import { saveMarketingSpend } from "../actions";
import { istDate, pct, reportHref } from "../format";

export const dynamic = "force-dynamic";

const SEGMENTS: Segment[] = ["Champions", "Loyal", "Potential loyalist", "New", "Needs attention", "At risk", "About to sleep", "Can't lose", "Hibernating"];
const SORTS = { ltv: "Highest value", recent: "Most recent", orders: "Most orders", returns: "Most returned" } as const;
type Sort = keyof typeof SORTS;

const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
};

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ segment?: string; sort?: string; page?: string }> }) {
  const session = await requirePermission("finance:view");
  if (!session) return <NoAccess />;
  const canEdit = can(session.role, "settings:manage");
  const params = await searchParams;
  const now = new Date();
  const data = await customerData(now);
  const segment = SEGMENTS.find((s) => s === params.segment) ?? null;
  const sort: Sort = params.sort && params.sort in SORTS ? (params.sort as Sort) : "ltv";

  const buyers = data.profiles.filter((p) => p.keptOrders > 0);
  const listed = buyers
    .filter((p) => !segment || data.rfm.get(p.key)?.segment === segment)
    .sort((a, b) =>
      sort === "recent"
        ? b.lastOrderAt.getTime() - a.lastOrderAt.getTime()
        : sort === "orders"
          ? b.keptOrders - a.keptOrders || b.ltvPaise - a.ltvPaise
          : sort === "returns"
            ? (b.returnRatio ?? 0) - (a.returnRatio ?? 0) || b.orders - a.orders
            : b.ltvPaise - a.ltvPaise,
    );
  const page = parsePage(params.page, listed.length);
  const shown = pageOf(listed, page);
  const href = (p: Record<string, string | number | undefined>) =>
    reportHref("/admin/analytics/customers", { segment: segment ?? undefined, sort: sort === "ltv" ? undefined : sort, ...p });

  const repeat = buyers.filter((p) => p.keptOrders >= 2).length;
  const totalLtv = buyers.reduce((s, p) => s + p.ltvPaise, 0);
  const cadences = buyers.map((p) => p.cadenceDays).filter((c): c is number => c !== null).sort((a, b) => a - b);
  const bySegment = new Map<Segment, number>();
  for (const p of buyers) {
    const s = data.rfm.get(p.key)?.segment;
    if (s) bySegment.set(s, (bySegment.get(s) ?? 0) + 1);
  }
  const cohorts = data.cohorts.slice(-8);
  const economics = data.economics.filter((e) => e.newCustomers > 0 || e.spendPaise !== null).slice(-8);

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Customers</h1>
        <p className="mt-1 max-w-[70ch] text-small text-ink-soft">
          One profile per buyer: their signed-in account, or else their mobile number, or else their email. Value counts orders
          kept (paid, on the way or delivered); returned and cancelled orders don&apos;t count.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Buyers" value={buyers.length.toLocaleString("en-IN")} sub={`${data.profiles.length - buyers.length} with no kept order`} />
        <Stat label="Came back to buy again" value={pct(buyers.length ? repeat / buyers.length : null)} sub={`${repeat} repeat buyers`} />
        <Stat label="Average lifetime value" value={formatINR(buyers.length ? Math.round(totalLtv / buyers.length) : 0)} />
        <Stat label="Typical gap between orders" value={cadences.length ? `${Math.round(cadences[Math.floor(cadences.length / 2)])} days` : "—"} sub="Median, repeat buyers" />
        <Stat label="Champions and loyal" value={String((bySegment.get("Champions") ?? 0) + (bySegment.get("Loyal") ?? 0))} />
      </section>

      <div className="grid gap-3">
        <nav aria-label="Segments" className="flex flex-wrap gap-2 text-small">
          <Link href={reportHref("/admin/analytics/customers", { sort: sort === "ltv" ? undefined : sort })} className={`border px-2.5 py-1 ${!segment ? "border-strong font-semibold" : "border-rule text-ink-soft"}`} style={{ borderRadius: 2 }}>
            Everyone <span className="tabular">{buyers.length}</span>
          </Link>
          {SEGMENTS.filter((s) => bySegment.get(s)).map((s) => (
            <Link key={s} href={reportHref("/admin/analytics/customers", { segment: s, sort: sort === "ltv" ? undefined : sort })} className={`border px-2.5 py-1 ${segment === s ? "border-strong font-semibold" : "border-rule text-ink-soft"}`} style={{ borderRadius: 2 }}>
              {s} <span className="tabular">{bySegment.get(s)}</span>
            </Link>
          ))}
        </nav>
        {segment && <p className="text-small text-ink-soft">What to do: {SEGMENT_ACTION[segment]}</p>}
        <nav aria-label="Sort" className="flex flex-wrap gap-3 text-small">
          {(Object.keys(SORTS) as Sort[]).map((k) => (
            <Link key={k} href={reportHref("/admin/analytics/customers", { segment: segment ?? undefined, sort: k === "ltv" ? undefined : k })} className={k === sort ? "font-semibold underline" : "text-ink-soft hover:underline"}>
              {SORTS[k]}
            </Link>
          ))}
        </nav>
      </div>

      {listed.length === 0 ? (
        <Empty title="No customers here yet" detail="Profiles appear as orders are placed." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
          <div className="grid gap-3">
            <p className="text-micro text-ink-faint">
              Showing {(page - 1) * INTEL_PAGE_SIZE + 1}–{Math.min(page * INTEL_PAGE_SIZE, listed.length)} of {listed.length} · {SORTS[sort]}
            </p>
            <div className="panel">
              {shown.map((p) => {
                const rfm = data.rfm.get(p.key);
                return (
                  <Link key={p.key} href={`/admin/analytics/customers/${encodeURIComponent(p.key)}`} className="grid gap-0.5 border-b border-rule px-4 py-3 last:border-b-0 hover:bg-shelf">
                    <p className="flex flex-wrap items-baseline justify-between gap-2 text-small">
                      <span className="font-semibold">{p.name}</span>
                      <span className="tabular font-semibold">{formatINR(p.ltvPaise)}</span>
                    </p>
                    <p className="text-micro tabular text-ink-soft">
                      {rfm?.segment ?? "—"} · {p.keptOrders} kept of {p.orders} · last {istDate.format(p.lastOrderAt)}
                      {p.phone && ` · ${maskMobile(p.phone)}`}
                      {p.rto > 0 && <span className="font-semibold text-alert"> · {p.rto} returned to origin</span>}
                    </p>
                  </Link>
                );
              })}
            </div>
            <Pager page={page} pages={pageCount(listed.length)} href={(n) => href({ page: n === 1 ? undefined : n })} />
          </div>
          <div className="grid gap-4">
            <ChartCard title="Lifetime value" note="These ten buyers">
              <BarList rows={shown.map((p) => ({ label: p.name, value: p.ltvPaise, display: formatINR(p.ltvPaise) }))} />
            </ChartCard>
            <ChartCard title="Orders kept">
              <BarList rows={shown.map((p) => ({ label: p.name, value: p.keptOrders, color: SERIES[1] }))} />
            </ChartCard>
            <ChartCard title="Returned or refused" note="Share of their finished orders">
              <BarList max={1} rows={shown.map((p) => ({ label: p.name, value: p.returnRatio ?? 0, display: pct(p.returnRatio), color: BAD }))} />
            </ChartCard>
          </div>
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Buyers by segment" note="Recency and frequency (RFM), everyone">
          <Donut parts={SEGMENTS.filter((s) => bySegment.get(s)).map((s, i) => ({ label: s, value: bySegment.get(s) ?? 0, color: SERIES[i % SERIES.length] }))} />
        </ChartCard>
        <ChartCard title="Come back to buy again" note="Share of each month's new buyers ordering again, by months since their first order">
          <HeatGrid
            caption="Repeat purchase by monthly cohort"
            columns={["+1", "+2", "+3", "+4", "+5"]}
            format={(v) => pct(v)}
            rows={cohorts.map((c) => ({ label: monthLabel(c.month), sub: `${c.customers} new`, cells: c.retention }))}
          />
        </ChartCard>
      </section>

      <section className="grid gap-4">
        <div>
          <h2 className="text-h3 font-bold">Acquisition cost and lifetime value</h2>
          <p className="mt-1 max-w-[70ch] text-small text-ink-soft">
            Enter what was spent on marketing each month to see the cost of each new buyer (CAC) and how their value to date compares.
            Value uses margin (sale price before GST, less landed cost) where every product has a landed cost, otherwise revenue.
          </p>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full text-small tabular">
            <thead>
              <tr className="border-b border-rule text-left text-micro text-ink-soft">
                <th scope="col" className="p-2">Month</th>
                <th scope="col" className="p-2 text-right">New buyers</th>
                <th scope="col" className="p-2 text-right">Spend</th>
                <th scope="col" className="p-2 text-right">Cost per buyer</th>
                <th scope="col" className="p-2 text-right">Value to date</th>
                <th scope="col" className="p-2 text-right">Value ÷ cost</th>
              </tr>
            </thead>
            <tbody>
              {economics.map((e) => (
                <tr key={e.month} className="border-b border-rule last:border-b-0">
                  <th scope="row" className="p-2 text-left font-semibold">{monthLabel(e.month)}</th>
                  <td className="p-2 text-right">{e.newCustomers}</td>
                  <td className="p-2 text-right">{e.spendPaise === null ? "—" : formatINR(e.spendPaise)}</td>
                  <td className="p-2 text-right">{e.cacPaise === null ? "—" : formatINR(e.cacPaise)}</td>
                  <td className="p-2 text-right">
                    {formatINR(e.marginPerCustomerPaise ?? e.revenuePerCustomerPaise)}
                    <span className="text-micro text-ink-faint"> {e.marginPerCustomerPaise !== null ? "margin" : "revenue"}</span>
                  </td>
                  <td className={`p-2 text-right font-semibold ${e.ltvToCac !== null && e.ltvToCac < 1 ? "text-alert" : ""}`}>
                    {e.ltvToCac === null ? "—" : `${e.ltvToCac.toFixed(1)}×`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="panel">
            <div className="panel-head">Record a month&apos;s marketing spend</div>
            <ActionForm action={saveMarketingSpend} submitLabel="Save spend" className="grid gap-3 p-3 sm:grid-cols-3">
              <label className="grid gap-1 text-small">
                <span className="label">Month</span>
                <input name="month" type="month" className="field" defaultValue={monthKey(now)} required />
              </label>
              <label className="grid gap-1 text-small">
                <span className="label">Spend (₹)</span>
                <input name="amount" type="number" min={0} step="1" className="field" required />
              </label>
              <label className="grid gap-1 text-small">
                <span className="label">Note (optional)</span>
                <input name="note" className="field" maxLength={200} placeholder="Meta ads, influencers" />
              </label>
            </ActionForm>
          </div>
        )}
      </section>
    </div>
  );
}
