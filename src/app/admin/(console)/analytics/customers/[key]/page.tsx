import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import { NoAccess } from "@/components/ui";
import { BarList, ChartCard, Columns, Pager, StackedBar, Stat, SERIES, BAD, GOOD } from "@/components/charts";
import { pageCount, pageOf, parsePage } from "@/lib/intel/paging";
import { SEGMENT_ACTION } from "@/lib/intel/customers";
import { customerDetail } from "@/server/intel-reports";
import { istDate, pct, reportHref } from "../../format";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment", PAID: "Paid", PROCESSING: "Packing", SHIPPED: "Shipped", DELIVERED: "Delivered",
  CANCELLED: "Cancelled", REFUNDED: "Refunded", FAILED: "Payment failed", RTO: "Returned to origin", RETURNED: "Returned",
};

/** Customer 360: one buyer's value, rhythm, returns and behaviour. */
export default async function CustomerPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ page?: string }> }) {
  const session = await requirePermission("finance:view");
  if (!session) return <NoAccess />;
  const key = decodeURIComponent((await params).key);
  if (!/^[cpe]:.{1,200}$/.test(key)) notFound();
  const detail = await customerDetail(key);
  if (!detail) notFound();
  const { profile: p, rfm, orders, behaviour, account } = detail;
  const page = parsePage((await searchParams).page, orders.length);
  const shown = pageOf(orders, page);
  const now = new Date();
  const overdue = p.nextExpectedAt && p.nextExpectedAt < now;

  return (
    <div className="grid gap-8">
      <div>
        <Link href="/admin/analytics/customers" className="text-small underline">← Customers</Link>
        <h1 className="mt-2 text-h2 font-extrabold">{p.name}</h1>
        <p className="mt-1 text-small text-ink-soft">
          {[p.phone, p.email].filter(Boolean).join(" · ")}
          {account ? ` · signed-in account since ${istDate.format(account.createdAt)}` : " · guest checkouts"}
          {account?.marketingConsent ? " · agreed to offers" : ""}
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Lifetime value" value={formatINR(p.ltvPaise)} sub={p.marginPaise !== null ? `${formatINR(p.marginPaise)} margin` : undefined} />
        <Stat label="Orders kept" value={`${p.keptOrders} of ${p.orders}`} sub={`Average ${formatINR(p.aovPaise)}`} />
        <Stat label="Segment" value={rfm?.segment ?? "—"} sub={rfm ? `R${rfm.r} F${rfm.f} M${rfm.m}` : undefined} />
        <Stat
          label="Usual gap between orders"
          value={p.cadenceDays !== null ? `${Math.round(p.cadenceDays)} days` : "—"}
          sub={p.nextExpectedAt ? `${overdue ? "Overdue since" : "Next due"} ${istDate.format(p.nextExpectedAt)}` : "Needs two orders"}
          tone={overdue ? "bad" : undefined}
        />
        <Stat label="Returned or refused" value={pct(p.returnRatio)} sub={`${p.rto} returned to origin · ${p.returned} sent back`} tone={p.rto > 0 ? "bad" : undefined} />
      </section>
      {rfm && <p className="text-small text-ink-soft">What to do: {SEGMENT_ACTION[rfm.segment]}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        <section className="grid gap-3">
          <h2 className="text-h3 font-bold">Orders</h2>
          <div className="panel">
            {shown.map((o) => (
              <Link key={o.id} href={`/admin/orders/${o.id}`} className="grid gap-0.5 border-b border-rule px-4 py-2.5 text-small last:border-b-0 hover:bg-shelf">
                <p className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold tabular">{o.orderNumber}</span>
                  <span className="tabular">{formatINR(o.totalPaise)}</span>
                </p>
                <p className="text-micro tabular text-ink-soft">
                  {istDate.format(o.placedAt)} · {STATUS_LABEL[o.status] ?? o.status} · {o.cod ? "Cash on delivery" : "Paid online"} · {o.pincode ?? ""}
                  {o.riskScore !== null && ` · risk ${o.riskScore}`}
                </p>
              </Link>
            ))}
          </div>
          <Pager page={page} pages={pageCount(orders.length)} href={(n) => reportHref(`/admin/analytics/customers/${encodeURIComponent(key)}`, { page: n === 1 ? undefined : n })} />
        </section>
        <div className="grid gap-4">
          <ChartCard title="Order values" note="These orders, oldest to newest">
            <Columns points={[...shown].reverse().map((o) => ({ label: istDate.format(o.placedAt), value: o.totalPaise }))} format={(v) => formatINR(v)} color={SERIES[0]} />
          </ChartCard>
          <ChartCard title="How these orders ended">
            <StackedBar
              parts={[
                { label: "Kept", value: shown.filter((o) => ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"].includes(o.status)).length, color: GOOD },
                { label: "Returned or refused", value: shown.filter((o) => ["RTO", "RETURNED", "REFUNDED"].includes(o.status)).length, color: BAD },
                { label: "Cancelled or unpaid", value: shown.filter((o) => ["CANCELLED", "FAILED", "PENDING_PAYMENT"].includes(o.status)).length, color: SERIES[4] },
              ]}
            />
          </ChartCard>
          <ChartCard title="On the site" note="Sessions linked to their orders or basket">
            <BarList
              rows={[
                { label: "Product views", value: behaviour.productViews, color: SERIES[1] },
                { label: "Added to basket", value: behaviour.addToCart, color: SERIES[2] },
                { label: "Checkouts started", value: behaviour.checkoutsStarted, color: SERIES[0] },
                { label: "Checkouts left unfinished", value: behaviour.abandonedCheckouts, color: BAD },
              ]}
            />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
