import Link from "next/link";
import { db } from "@/lib/db";
import { SELLABLE_BATCH_WHERE } from "@/lib/basket-rules";
import { stockView } from "@/lib/stock-view";
import { findNearExpiryBatches } from "@/lib/compliance/fefo";
import { daysWaiting } from "@/lib/packing";
import { formatDate } from "@/lib/format";

/**
 * Today for roles whose work isn't the store's money (the owner's and
 * manager's Today is the dashboard in page.tsx). Fulfilment sees the packing
 * run first; content staff see what's waiting on words. No sales figures in
 * either. Each figure links to where it's dealt with.
 */

const DAY = 86_400_000;
/** The start of the last 30 days, read outside render. */
const thirtyDaysAgo = () => new Date(Date.now() - 30 * DAY);

function Card({ title, figure, note, href, cta }: { title: string; figure: string; note: string; href: string; cta: string }) {
  return (
    <div className="panel">
      <div className="panel-head">{title}</div>
      <div className="p-4">
        <p className="tabular font-display text-h2 font-extrabold">{figure}</p>
        <p className="text-small text-ink-soft">{note}</p>
        <Link href={href} className="mt-2 inline-block text-small font-semibold underline">
          {cta}
        </Link>
      </div>
    </div>
  );
}

export async function FulfilmentToday() {
  const now = new Date();
  const [toPack, oldest, cod, returns, shipped, products] = await Promise.all([
    db.order.count({ where: { status: { in: ["PAID", "PROCESSING"] } } }),
    db.order.findFirst({ where: { status: { in: ["PAID", "PROCESSING"] } }, orderBy: { placedAt: "asc" }, select: { placedAt: true } }),
    db.order.count({ where: { status: { in: ["PAID", "PROCESSING"] }, paymentGateway: "COD" } }),
    db.order.count({ where: { status: { in: ["RTO", "RETURNED"] }, items: { some: { OR: [{ returnCheck: null }, { returnCheck: { outcome: "QUARANTINED" } }] } } } }),
    db.order.count({ where: { status: "SHIPPED" } }),
    db.product.findMany({ where: { isActive: true }, include: { batches: { where: SELLABLE_BATCH_WHERE } } }),
  ]);
  const waited = oldest ? daysWaiting(oldest.placedAt, now) : 0;
  const low = products
    .map((p) => ({ name: p.name, shippable: stockView(p, now).shippable, low: stockView(p, now).low }))
    .filter((p) => p.low)
    .sort((a, b) => a.shippable - b.shippable)
    .slice(0, 4);
  const expiring = products
    .flatMap((p) =>
      p.shelfLifeDays && p.batches.length
        ? findNearExpiryBatches(
            p.batches.map((b) => ({ id: b.id, batchNumber: b.batchNumber, expiresOn: b.expiresOn, quantityRemaining: b.quantityRemaining })),
            p.shelfLifeDays,
            now,
            21,
          ).map((b) => ({ name: p.name, batch: b.batchNumber, days: b.daysUntilUnsellable }))
        : [],
    )
    .sort((a, b) => a.days - b.days)
    .slice(0, 3);

  return (
    <div className="grid gap-6">
      <h1 className="text-h2 font-extrabold">Today</h1>
      <section className="flex flex-wrap items-center justify-between gap-6 border-2 border-strong bg-surface p-6" style={{ borderRadius: "var(--radius-panel)" }}>
        <div>
          <p className="text-small text-ink-soft">To pack and ship</p>
          <p className="tabular font-display text-[3rem] leading-tight font-extrabold">
            {toPack} {toPack === 1 ? "order" : "orders"}
          </p>
          {toPack > 0 && (
            <p className={`text-small ${waited >= 3 ? "font-semibold text-alert" : "text-ink-soft"}`}>
              The oldest has waited {waited === 0 ? "less than a day" : `${waited} ${waited === 1 ? "day" : "days"}`} · {cod} {cod === 1 ? "is" : "are"} cash on delivery
            </p>
          )}
        </div>
        {toPack > 0 && (
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/orders/packing" className="btn btn-solid">
              Start the packing run
            </Link>
            <Link href="/admin/orders?view=to_ship" className="btn btn-outline">
              See the queue
            </Link>
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Parcels back to check" figure={String(returns)} note="Back to stock, set aside or write off, line by line" href="/admin/orders?view=returned" cta="Check them →" />
        <Card title="Out for delivery" figure={String(shipped)} note="Shipped, not yet marked delivered" href="/admin/orders?view=shipped" cta="Mark delivered →" />
        <div className="panel">
          <div className="panel-head">Stock to watch</div>
          <ul className="grid gap-1.5 p-4 text-small">
            {low.map((p) => (
              <li key={p.name} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="tabular shrink-0 font-semibold">{p.shippable} left</span>
              </li>
            ))}
            {expiring.map((b) => (
              <li key={`${b.name}${b.batch}`} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {b.name} <span className="tabular text-ink-faint">{b.batch}</span>
                </span>
                <span className="tabular shrink-0 font-semibold text-alert">{b.days} days to unsellable</span>
              </li>
            ))}
            {low.length + expiring.length === 0 && <li className="text-ink-faint">Nothing running low or close to unsellable.</li>}
            <li className="mt-1">
              <Link href="/admin/batches" className="font-semibold underline">
                Receive stock →
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export async function ContentToday() {
  const since = thirtyDaysAgo();
  const [reviews, latest, drafts, misses] = await Promise.all([
    db.review.count({ where: { isApproved: false } }),
    db.review.findMany({ where: { isApproved: false }, orderBy: { createdAt: "asc" }, take: 3, select: { id: true, customerName: true, rating: true, product: { select: { name: true } } } }),
    db.article.findMany({ where: { published: false }, orderBy: { updatedAt: "desc" }, take: 3, select: { id: true, title: true, updatedAt: true } }),
    db.$queryRaw<{ q: string; n: bigint }[]>`
      SELECT metadata->>'q' AS q, count(*) AS n FROM "AnalyticsEvent"
      WHERE type = 'SEARCHED' AND "createdAt" >= ${since} AND (metadata->>'results')::int = 0 AND metadata->>'q' IS NOT NULL
      GROUP BY 1 ORDER BY n DESC LIMIT 5`,
  ]);
  return (
    <div className="grid gap-6">
      <h1 className="text-h2 font-extrabold">Today</h1>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel">
          <div className="panel-head flex justify-between">
            <span>Reviews to approve</span>
            <span className="tabular">{reviews}</span>
          </div>
          <ul className="grid gap-1.5 p-4 text-small">
            {latest.map((r) => (
              <li key={r.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {r.product.name} · {r.customerName}
                </span>
                <span aria-label={`${r.rating} stars`} style={{ color: "var(--color-caution)" }}>
                  {"★".repeat(r.rating)}
                </span>
              </li>
            ))}
            {reviews === 0 && <li className="text-ink-faint">None waiting.</li>}
            <li className="mt-1">
              <Link href="/admin/reviews" className="font-semibold underline">
                Open the queue →
              </Link>
            </li>
          </ul>
        </div>
        <div className="panel">
          <div className="panel-head">Searches that found nothing · 30 days</div>
          <ul className="grid gap-1.5 p-4 text-small">
            {misses.map((m) => (
              <li key={m.q} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">&ldquo;{m.q}&rdquo;</span>
                <span className="tabular shrink-0 text-ink-soft">{Number(m.n)}×</span>
              </li>
            ))}
            {misses.length === 0 && <li className="text-ink-faint">Every search found something.</li>}
            <li className="mt-1">
              <Link href="/admin/analytics/site" className="font-semibold underline">
                See search terms →
              </Link>
            </li>
          </ul>
        </div>
        <div className="panel">
          <div className="panel-head">Articles in draft</div>
          <ul className="grid gap-1.5 p-4 text-small">
            {drafts.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <Link href={`/admin/articles/${a.id}`} className="min-w-0 truncate underline">
                  {a.title}
                </Link>
                <span className="shrink-0 text-ink-faint">{formatDate(a.updatedAt)}</span>
              </li>
            ))}
            {drafts.length === 0 && <li className="text-ink-faint">No drafts.</li>}
            <li className="mt-1">
              <Link href="/admin/articles" className="font-semibold underline">
                All articles →
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
