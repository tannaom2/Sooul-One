import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatINR } from "@/lib/money";
import { decimalToPaise, formatDate } from "@/lib/format";
import { percentChange } from "@/lib/order-filters";
import { findNearExpiryBatches } from "@/lib/compliance/fefo";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { getReadiness } from "@/server/launch-readiness";
import { getStoreControls } from "@/server/store-settings";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function Dashboard() {
  const session = await requirePermission("dashboard:view");
  if (!session) return <NoAccess />;
  const canSeeFinance = can(session.role, "finance:view");
  const canSeeOrders = can(session.role, "orders:view");

  const now = new Date();
  const DAY = 24 * 60 * 60 * 1000;
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since60 = new Date(now.getTime() - 60 * DAY);
  const since24h = new Date(now.getTime() - DAY);

  // Revenue counts orders that were paid for (or are COD and on their way);
  // abandoned, failed, cancelled and refunded orders are left out.
  const earning = { status: { in: ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] as any } };
  const period = (from: Date, to: Date) => ({ ...earning, placedAt: { gte: from, lt: to } });

  let orders: any[] = [];
  let products: any[] = [];
  let runningLow: any[] = [];
  let toShip = 0;
  let pendingReviews = 0;
  let failedSignIns = 0;
  let current = { revenue: 0, orders: 0 };
  let previous = { revenue: 0, orders: 0 };

  try {
    const [recent, live, low, ship, reviews, failed, cur, prev] = await Promise.all([
      db.order.findMany({ orderBy: { placedAt: "desc" }, take: 8 }),
      db.product.findMany({ where: { isActive: true }, include: { batches: true } }),
      db.product.findMany({
        where: { isActive: true, stockQuantity: { lte: db.product.fields.lowStockThreshold } },
        orderBy: { stockQuantity: "asc" },
      }),
      canSeeOrders ? db.order.count({ where: { status: { in: ["PAID", "PROCESSING"] } } }) : 0,
      can(session.role, "reviews:moderate") ? db.review.count({ where: { isApproved: false } }) : 0,
      can(session.role, "audit:view")
        ? db.adminAuditLog.count({
            where: {
              action: { in: ["SIGN_IN_FAILED", "SIGN_IN_LOCKED", "MFA_FAILED", "MFA_LOCKED"] },
              createdAt: { gte: since24h },
            },
          })
        : 0,
      db.order.aggregate({ where: period(since30, now), _sum: { totalAmount: true }, _count: { _all: true } }),
      db.order.aggregate({ where: period(since60, since30), _sum: { totalAmount: true }, _count: { _all: true } }),
    ]);
    orders = recent;
    products = live;
    runningLow = low;
    toShip = ship;
    pendingReviews = reviews;
    failedSignIns = failed;
    current = { revenue: decimalToPaise(cur._sum.totalAmount), orders: cur._count._all };
    previous = { revenue: decimalToPaise(prev._sum.totalAmount), orders: prev._count._all };
  } catch (error) {
    reportError("admin/dashboard", error);
    return (
      <Empty
        title="Can't reach the database"
        detail="Check DATABASE_URL and that migrations have run. The rest of the console needs a working connection."
      />
    );
  }

  /**
   * Near-expiry is a different alert from low stock and is computed against the
   * point a batch stops being SHIPPABLE, not its printed expiry. For a
   * long-dated product those are many weeks apart, and alerting on expiry
   * would fire far too late to do anything about it.
   */
  const nearExpiry = products.flatMap((p) => {
    if (!p.shelfLifeDays || !p.batches?.length) return [];
    return findNearExpiryBatches(
      p.batches.map((b: any) => ({
        id: b.id,
        batchNumber: b.batchNumber,
        expiresOn: new Date(b.expiresOn),
        quantityRemaining: b.quantityRemaining,
      })),
      p.shelfLifeDays,
      now,
      21,
    ).map((b) => ({ ...b, productName: p.name, productId: p.id }));
  });

  // The launch checklist leads while anything required is outstanding.
  const launchBlockers = can(session.role, "settings:manage")
    ? await getReadiness()
        .then((r) => r.blockers.length)
        .catch(() => 0)
    : 0;

  // A paused store is the first thing anyone signing in should see.
  const controls = await getStoreControls();

  // Only items this person can act on, and only when there is something to do.
  const attention = [
    controls.ordersPaused && {
      href: can(session.role, "settings:manage") ? "/admin/controls" : "/admin",
      text: "Orders are paused: shoppers can't check out",
      warn: true,
    },
    !controls.codEnabled && {
      href: can(session.role, "settings:manage") ? "/admin/controls#cod" : "/admin#cod",
      text: "Cash on delivery is switched off",
    },
    launchBlockers > 0 && {
      href: "/admin/launch",
      text: `${launchBlockers} ${launchBlockers === 1 ? "item" : "items"} left before the site can take orders`,
      warn: true,
    },
    canSeeOrders && toShip > 0 && {
      href: "/admin/orders?view=to_ship",
      text: `${toShip} ${toShip === 1 ? "order" : "orders"} to pack and ship`,
    },
    pendingReviews > 0 && {
      href: "/admin/reviews",
      text: `${pendingReviews} ${pendingReviews === 1 ? "review" : "reviews"} waiting for approval`,
    },
    can(session.role, "batches:write") && nearExpiry.length > 0 && {
      href: "#expiry",
      text: `${nearExpiry.length} ${nearExpiry.length === 1 ? "batch" : "batches"} close to unsellable`,
      warn: true,
    },
    can(session.role, "products:view") && runningLow.length > 0 && {
      href: "#low-stock",
      text: `${runningLow.length} ${runningLow.length === 1 ? "product" : "products"} running low`,
    },
    failedSignIns > 0 && {
      href: "/admin/activity?area=AdminUser",
      text: `${failedSignIns} failed sign-in ${failedSignIns === 1 ? "attempt" : "attempts"} in the last 24 hours`,
      warn: true,
    },
  ].filter((a): a is { href: string; text: string; warn?: boolean } => Boolean(a));

  const tiles = [
    canSeeFinance && {
      label: "Revenue, last 30 days",
      value: formatINR(current.revenue),
      change: percentChange(current.revenue, previous.revenue),
    },
    canSeeOrders && {
      label: "Orders, last 30 days",
      value: String(current.orders),
      change: percentChange(current.orders, previous.orders),
    },
    { label: "Live products", value: String(products.length), change: undefined },
  ].filter((t): t is { label: string; value: string; change: number | null | undefined } => Boolean(t));

  return (
    <div className="grid gap-10">
      <section aria-labelledby="attention-heading">
        <h1 id="attention-heading" className="mb-3 text-h2 font-extrabold">
          Needs attention
        </h1>
        {attention.length === 0 ? (
          <p className="panel p-4 text-small text-ink-soft">All caught up. Nothing needs you right now.</p>
        ) : (
          <ul className="panel">
            {attention.map((a) => (
              <li key={a.href} className="border-b border-[--color-rule] last:border-b-0">
                <Link href={a.href} className="flex items-center justify-between gap-3 px-4 py-3 text-small hover:bg-shelf">
                  <span className={a.warn ? "font-semibold text-alert" : "font-semibold"}>{a.text}</span>
                  <span aria-hidden className="text-ink-faint">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="panel p-4">
            <p className="text-small text-ink-soft">{t.label}</p>
            <p className="tabular mt-1 font-display text-h2 font-extrabold">{t.value}</p>
            {t.change !== undefined && (
              <p className="text-micro text-ink-faint">
                {t.change === null ? (
                  "No sales in the 30 days before to compare with"
                ) : (
                  <>
                    <span className="tabular" style={{ color: t.change >= 0 ? "var(--color-veg)" : "var(--color-alert)" }}>
                      {t.change > 0 ? "+" : t.change < 0 ? "−" : ""}
                      {Math.abs(t.change)}%
                    </span>{" "}
                    vs the 30 days before
                  </>
                )}
              </p>
            )}
          </div>
        ))}
      </section>

      {/* Two alerts, kept visually distinct because they demand different
          actions: reorder versus move it before it becomes unsellable. */}
      <section className="grid gap-5 lg:grid-cols-2">
        <div id="low-stock" className="panel scroll-mt-6">
          <div className="panel-head">Running low</div>
          {runningLow.length === 0 ? (
            <p className="p-3.5 text-small text-ink-soft">Nothing below its reorder threshold.</p>
          ) : (
            <ul>
              {runningLow.slice(0, 8).map((p) => (
                <li key={p.id} className="panel-row">
                  <span>{p.name}</span>
                  <span className="tabular">{p.stockQuantity} left</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div id="expiry" className="panel scroll-mt-6" style={{ borderColor: nearExpiry.length ? "var(--color-caution)" : undefined }}>
          <div className="panel-head" style={{ borderColor: nearExpiry.length ? "var(--color-caution)" : undefined }}>
            Approaching unsellable
          </div>
          {nearExpiry.length === 0 ? (
            <p className="p-3.5 text-small text-ink-soft">
              No batch is close to breaching the delivery freshness rule.
            </p>
          ) : (
            <>
              <ul>
                {nearExpiry.slice(0, 8).map((b) => (
                  <li key={b.batchId} className="panel-row">
                    <span>
                      {b.productName}
                      <span className="ml-2 text-ink-faint">{b.batchNumber}</span>
                    </span>
                    <span className="tabular" style={{ color: "var(--color-caution)" }}>
                      {b.daysUntilUnsellable <= 0
                        ? "unsellable now"
                        : `${b.daysUntilUnsellable} days`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-[--color-rule] p-3.5 text-micro text-ink-faint">
                These batches stop being shippable well before their printed expiry. Move them
                through the stores or discount them now.
              </p>
            </>
          )}
        </div>
      </section>

      {canSeeOrders && (
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-h3 font-bold">Recent orders</h2>
          <Link href="/admin/orders" className="text-small underline">
            All orders
          </Link>
        </div>
        {orders.length === 0 ? (
          <Empty title="No orders yet" detail="Orders will appear here as soon as the first one is placed." />
        ) : (
          <div className="panel">
            {orders.map((o) => (
              <Link key={o.id} href={`/admin/orders/${o.id}`} className="panel-row hover:bg-shelf">
                <span className="tabular">
                  {o.orderNumber}
                  <span className="ml-3 text-ink-faint">{formatDate(o.placedAt)}</span>
                </span>
                <span>
                  <span className="mr-3 text-ink-soft">{o.status.replace(/_/g, " ").toLowerCase()}</span>
                  <span className="tabular font-semibold">{formatINR(decimalToPaise(o.totalAmount))}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
      )}
    </div>
  );
}
