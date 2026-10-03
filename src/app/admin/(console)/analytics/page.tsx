import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { buildOrderAnalytics } from "@/lib/order-analytics";
import { formatINR } from "@/lib/money";
import { Empty, NoAccess } from "@/components/ui";
import { BarList, ChartCard, Columns, HeatGrid, Stat, TrendLine, SERIES } from "@/components/charts";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Hours shown in the heat grid, in blocks of three. */
const BLOCKS = [0, 3, 6, 9, 12, 15, 18, 21];

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requirePermission("finance:view");
  if (!session) return <NoAccess />;

  const { days: daysParam } = await searchParams;
  const days = Math.max(1, Math.min(365, Number(daysParam) || 30));

  const report = await buildOrderAnalytics(days);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-h2 font-extrabold">Order analytics</h1>
        <div className="flex items-center gap-3 text-small">
          <span className="text-ink-faint">Last</span>
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`/admin/analytics?days=${d}`}
              className={d === days ? "font-semibold underline" : "text-ink-soft hover:underline"}
            >
              {d} days
            </Link>
          ))}
        </div>
      </div>

      {report.orderCount === 0 ? (
        <Empty title="No orders in this window" detail="Numbers appear here once orders start clearing." />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Revenue" value={formatINR(report.revenuePaise)} sub={`${report.orderCount} orders`} />
            <Stat label="Average order value" value={formatINR(report.averageOrderValuePaise)} />
            <Stat label="New customers" value={String(report.newCustomerOrders)} sub={`of ${report.distinctCustomers} distinct mobile numbers`} />
            <Stat label="Repeat customers" value={String(report.repeatCustomerOrders)} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Revenue per day" note="Paid, packing, shipped and delivered orders">
              <TrendLine
                points={report.revenueByDay.map((d) => ({ label: dayLabel(d.day), value: d.revenuePaise }))}
                format={(v) => formatINR(v)}
                color={SERIES[0]}
              />
            </ChartCard>
            <ChartCard title="Orders per day">
              <Columns points={report.revenueByDay.map((d) => ({ label: dayLabel(d.day), value: d.orderCount }))} color={SERIES[1]} />
            </ChartCard>
          </section>

          <ChartCard title="When orders come in" note="Orders by weekday and time of day, India time, in three-hour blocks">
            <HeatGrid
              caption="Orders by weekday and three-hour block"
              columns={BLOCKS.map((h) => `${String(h).padStart(2, "0")}–${String(h + 3).padStart(2, "0")}`)}
              format={(v) => String(v)}
              rows={WEEKDAYS.map((w, i) => ({
                label: w,
                cells: BLOCKS.map((h) => report.ordersByWeekdayHour[i].slice(h, h + 3).reduce((a, b) => a + b, 0)),
              }))}
            />
          </ChartCard>

          <section className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Best-selling products" note="By revenue">
              <BarList rows={report.topProducts.map((p) => ({ label: `${p.name} (${p.quantity})`, value: p.revenuePaise, display: formatINR(p.revenuePaise) }))} />
            </ChartCard>
            <ChartCard title="Best-selling brands">
              <BarList rows={report.topBrands.map((b, i) => ({ label: b.name, value: b.revenuePaise, display: formatINR(b.revenuePaise), color: SERIES[(i + 1) % SERIES.length] }))} />
            </ChartCard>
            <ChartCard title="Revenue by state">
              <BarList rows={report.revenueByState.map((s) => ({ label: `${s.state} (${s.orderCount})`, value: s.revenuePaise, display: formatINR(s.revenuePaise), color: SERIES[2] }))} />
            </ChartCard>
          </section>

          <p className="text-small text-ink-soft">
            Deeper reports: <Link href="/admin/analytics/pincodes" className="underline">pincodes</Link>,{" "}
            <Link href="/admin/analytics/payments" className="underline">payment health</Link>,{" "}
            <Link href="/admin/analytics/customers" className="underline">customers</Link> and{" "}
            <Link href="/admin/analytics/risk" className="underline">RTO risk</Link>.
          </p>
        </>
      )}
    </div>
  );
}
