import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import { decimalToPaise, formatDate } from "@/lib/format";
import { findNearExpiryBatches } from "@/lib/compliance/fefo";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function Dashboard() {
  const session = await requireAdmin();
  if (!session) return null;

  let orders: any[] = [];
  let products: any[] = [];
  let lowStock: any[] = [];

  try {
    [orders, products, lowStock] = await Promise.all([
      db.order.findMany({ orderBy: { placedAt: "desc" }, take: 8 }),
      db.product.findMany({
        where: { isActive: true },
        include: { batches: true },
      }),
      db.product.findMany({ where: { isActive: true }, take: 100 }),
    ]);
  } catch {
    return (
      <Empty
        title="Can't reach the database"
        detail="Check DATABASE_URL and that migrations have run. The rest of the console needs a working connection."
      />
    );
  }

  const paid = orders.filter((o) => ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"].includes(o.status));
  const revenuePaise = paid.reduce((sum, o) => sum + decimalToPaise(o.totalAmount), 0);

  const runningLow = lowStock.filter((p) => p.stockQuantity <= p.lowStockThreshold);

  /**
   * Near-expiry is a different alert from low stock and is computed against the
   * point a batch stops being SHIPPABLE, not its printed expiry. For a
   * long-dated product those are many weeks apart, and alerting on expiry
   * would fire far too late to do anything about it.
   */
  const now = new Date();
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

  return (
    <div className="grid gap-10">
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["Recent revenue", formatINR(revenuePaise), `${paid.length} paid orders`],
          ["Live products", String(products.length), "across all brands"],
          ["Orders awaiting action", String(orders.filter((o) => o.status === "PAID" || o.status === "PROCESSING").length), "paid or packing"],
        ].map(([label, value, sub]) => (
          <div key={label} className="panel p-4">
            <p className="text-small text-ink-soft">{label}</p>
            <p className="tabular mt-1 font-display text-h2 font-extrabold">{value}</p>
            <p className="text-micro text-ink-faint">{sub}</p>
          </div>
        ))}
      </section>

      {/* Two alerts, kept visually distinct because they demand different
          actions: reorder versus move it before it becomes unsellable. */}
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="panel">
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

        <div className="panel" style={{ borderColor: nearExpiry.length ? "var(--color-caution)" : undefined }}>
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
              <div key={o.id} className="panel-row">
                <span className="tabular">
                  {o.orderNumber}
                  <span className="ml-3 text-ink-faint">{formatDate(o.placedAt)}</span>
                </span>
                <span>
                  <span className="mr-3 text-ink-soft">{o.status.replace(/_/g, " ").toLowerCase()}</span>
                  <span className="tabular font-semibold">{formatINR(decimalToPaise(o.totalAmount))}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
