import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { buildOrderAnalytics } from "@/lib/order-analytics";
import { formatINR } from "@/lib/money";
import { Empty, NoAccess } from "@/components/ui";

export const dynamic = "force-dynamic";

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
    <div className="grid gap-10">
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
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Revenue", formatINR(report.revenuePaise), `${report.orderCount} orders`],
              ["Average order value", formatINR(report.averageOrderValuePaise), null],
              ["New customers", String(report.newCustomerOrders), `of ${report.distinctCustomers} distinct emails`],
              ["Repeat customers", String(report.repeatCustomerOrders), null],
            ].map(([label, value, sub]) => (
              <div key={label} className="panel p-4">
                <p className="text-micro text-ink-faint">{label}</p>
                <p className="tabular text-lead font-bold">{value}</p>
                {sub && <p className="mt-1 text-micro text-ink-faint">{sub}</p>}
              </div>
            ))}
          </section>

          <section>
            <h2 className="mb-3 text-h3 font-bold">Best-selling products</h2>
            <div className="grid gap-2">
              {report.topProducts.map((p) => (
                <div key={p.productId} className="panel flex flex-wrap items-center justify-between gap-2 p-3">
                  <p className="text-small font-medium">{p.name}</p>
                  <p className="tabular text-small text-ink-faint">
                    {p.quantity} sold · {formatINR(p.revenuePaise)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-h3 font-bold">Best-selling brands</h2>
            <div className="grid gap-2">
              {report.topBrands.map((b) => (
                <div key={b.brandId} className="panel flex flex-wrap items-center justify-between gap-2 p-3">
                  <p className="text-small font-medium">{b.name}</p>
                  <p className="tabular text-small text-ink-faint">{formatINR(b.revenuePaise)}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-h3 font-bold">Revenue by state</h2>
            <div className="grid gap-2">
              {report.revenueByState.map((s) => (
                <div key={s.state} className="panel flex flex-wrap items-center justify-between gap-2 p-3">
                  <p className="text-small font-medium">{s.state}</p>
                  <p className="tabular text-small text-ink-faint">
                    {s.orderCount} orders · {formatINR(s.revenuePaise)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
