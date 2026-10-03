import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { BarList, ChartCard, Stat, SERIES } from "@/components/charts";
import { reportError } from "@/lib/observability";
import { formatINR } from "@/lib/money";
import { REVENUE_STATUSES } from "@/lib/order-analytics";
import { PAID_MEDIA } from "@/lib/attribution";
import { INTEL_PAGE_SIZE } from "@/lib/intel/paging";
import { daysAgo, parseDays, pct, reportHref } from "../format";

export const dynamic = "force-dynamic";

interface Row {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  orders: number;
  revenuePaise: number;
}

const label = (r: Pick<Row, "source" | "medium">) =>
  r.source === null ? "Not recorded" : r.source === "(direct)" ? "Direct" : `${r.source} / ${r.medium}`;

/**
 * Which ads, campaigns and sites bring orders (src/lib/attribution.ts):
 * counted on the visit just before each order, with the first-ever visit
 * alongside, since a shopper often finds us through one thing and orders
 * after another. Orders that took money only, like the Overview.
 */
export default async function CampaignsReport({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await requirePermission("finance:view");
  if (!session) return <NoAccess />;
  const windowDays = parseDays((await searchParams).days, 30);
  const since = daysAgo(windowDays);
  const statuses = [...REVENUE_STATUSES];

  let last: Row[] = [];
  let first: Row[] = [];
  try {
    const grouped = (touch: "first" | "last", withCampaign: boolean) => db.$queryRaw<{ source: string | null; medium: string | null; campaign: string | null; orders: bigint; paise: bigint }[]>`
      SELECT attribution->${touch}::text->>'source' AS source,
             attribution->${touch}::text->>'medium' AS medium,
             CASE WHEN ${withCampaign}::boolean THEN attribution->${touch}::text->>'campaign' END AS campaign,
             count(*) AS orders,
             coalesce(round(sum("totalAmount") * 100), 0)::bigint AS paise
      FROM "Order"
      WHERE "placedAt" >= ${since} AND status::text = ANY(${statuses})
      GROUP BY 1, 2, 3
      ORDER BY paise DESC
      LIMIT 200`;
    const conv = (r: { source: string | null; medium: string | null; campaign: string | null; orders: bigint; paise: bigint }): Row => ({
      source: r.source,
      medium: r.medium,
      campaign: r.campaign,
      orders: Number(r.orders),
      revenuePaise: Number(r.paise),
    });
    const [l, f] = await Promise.all([grouped("last", true), grouped("first", false)]);
    last = l.map(conv);
    first = f.map(conv);
  } catch (error) {
    reportError("admin/analytics/campaigns", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  const orders = last.reduce((t, r) => t + r.orders, 0);
  const revenue = last.reduce((t, r) => t + r.revenuePaise, 0);
  const recorded = last.filter((r) => r.source !== null).reduce((t, r) => t + r.orders, 0);
  const paid = last.filter((r) => r.medium !== null && PAID_MEDIA.has(r.medium));
  const paidOrders = paid.reduce((t, r) => t + r.orders, 0);
  const paidRevenue = paid.reduce((t, r) => t + r.revenuePaise, 0);

  // Source / medium, campaigns folded together, for the charts.
  const bySource = (rows: Row[]) => {
    const m = new Map<string, Row>();
    for (const r of rows) {
      const k = label(r);
      const cur = m.get(k);
      m.set(k, cur ? { ...cur, orders: cur.orders + r.orders, revenuePaise: cur.revenuePaise + r.revenuePaise } : { ...r, campaign: null });
    }
    return [...m.values()].sort((a, b) => b.revenuePaise - a.revenuePaise).slice(0, INTEL_PAGE_SIZE);
  };
  const campaigns = last.filter((r) => r.campaign).slice(0, 50);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h2 font-extrabold">Campaigns and sources</h1>
          <p className="mt-1 max-w-[72ch] text-small text-ink-soft">
            Where the last {windowDays} days&apos; orders came from. Tag every ad and post link with utm_source, utm_medium and
            utm_campaign (Google and Meta ads can add them for you) and each order is counted against it here. A visit with no
            tags is counted against the site it came from, or as direct.
          </p>
        </div>
        <nav aria-label="Window" className="flex gap-1 text-small">
          {[7, 30, 90].map((d) => (
            <Link key={d} replace href={reportHref("/admin/analytics/campaigns", { days: d === 30 ? undefined : d })} aria-current={d === windowDays ? "page" : undefined} className={`border px-2 py-1 ${d === windowDays ? "border-ink font-semibold" : "border-rule text-ink-soft"}`}>
              {d} days
            </Link>
          ))}
        </nav>
      </div>

      {orders === 0 ? (
        <Empty title="No orders in this window" detail="Sources appear here as orders come in." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Orders" value={orders.toLocaleString("en-IN")} sub={formatINR(revenue)} />
            <Stat label="Source recorded" value={pct(recorded / orders)} sub={`${recorded} ${recorded === 1 ? "order" : "orders"}`} />
            <Stat label="From paid ads" value={paidOrders.toLocaleString("en-IN")} sub={pct(paidOrders / orders)} />
            <Stat label="Paid-ad revenue" value={formatINR(paidRevenue)} sub={paidOrders ? `${formatINR(Math.round(paidRevenue / paidOrders))} per order` : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Revenue by source, before ordering" note="The visit just before each order">
              <BarList rows={bySource(last).map((r) => ({ label: label(r), value: r.revenuePaise, display: `${formatINR(r.revenuePaise)} · ${r.orders}`, color: SERIES[0] }))} />
            </ChartCard>
            <ChartCard title="Revenue by source, first visit" note="How these shoppers first found us">
              <BarList rows={bySource(first).map((r) => ({ label: label(r), value: r.revenuePaise, display: `${formatINR(r.revenuePaise)} · ${r.orders}`, color: SERIES[1] }))} />
            </ChartCard>
          </div>

          <section aria-labelledby="campaigns">
            <h2 id="campaigns" className="mb-3 text-h3 font-bold">
              Campaigns
            </h2>
            {campaigns.length === 0 ? (
              <p className="text-small text-ink-soft">No orders from a link with utm_campaign yet.</p>
            ) : (
              <div className="panel">
                <div className="panel-row font-semibold">
                  <span>Campaign · source / medium</span>
                  <span>Orders · revenue · per order</span>
                </div>
                {campaigns.map((r) => (
                  <div key={`${r.source}|${r.medium}|${r.campaign}`} className="panel-row">
                    <span className="min-w-0 break-words">
                      <span className="font-semibold">{r.campaign}</span> <span className="text-ink-soft">· {label(r)}</span>
                    </span>
                    <span className="tabular whitespace-nowrap">
                      {r.orders} · {formatINR(r.revenuePaise)} · {formatINR(Math.round(r.revenuePaise / r.orders))}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-micro text-ink-soft">
              Orders placed after a phone-to-laptop switch, or with cookies blocked, show as not recorded. Google Analytics and
              Meta conversion tracking can be added once those accounts exist; these numbers come from our own orders and
              don&apos;t need them.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
