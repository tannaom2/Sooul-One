import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { Empty } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { decimalToPaise, formatDate } from "@/lib/format";
import { OrderStatusForm } from "./status-form";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function Orders() {
  const session = await requireAdmin();
  if (!session) return null;

  let orders: any[] = [];
  try {
    orders = await db.order.findMany({
      include: { items: true },
      orderBy: { placedAt: "desc" },
      take: 100,
    });
  } catch {
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  if (orders.length === 0) {
    return <Empty title="No orders yet" detail="Orders appear here the moment the first one is placed." />;
  }

  return (
    <div>
      <h1 className="mb-6 text-h2 font-extrabold">Orders</h1>
      <div className="grid gap-4">
        {orders.map((o) => {
          const address = o.shippingAddress as any;
          return (
            <div key={o.id} className="panel">
              <div className="panel-head flex flex-wrap items-center justify-between gap-2">
                <span className="tabular">{o.orderNumber}</span>
                <span className="text-micro font-normal text-ink-faint">
                  {formatDate(o.placedAt)} · {o.status.replace(/_/g, " ").toLowerCase()}
                </span>
              </div>

              <div className="grid gap-4 p-3.5 sm:grid-cols-[1fr_1fr]">
                <div className="text-small">
                  <p className="font-semibold">Items</p>
                  <ul className="mt-1 grid gap-0.5 text-ink-soft">
                    {o.items.map((i: any) => (
                      <li key={i.id} className="tabular">
                        {i.productNameSnapshot} × {i.quantity}
                        {i.batchId && <span className="ml-2 text-ink-faint">batch on file</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 tabular font-semibold">
                    {formatINR(decimalToPaise(o.totalAmount))}
                  </p>
                </div>

                <div className="text-small">
                  <p className="font-semibold">Deliver to</p>
                  <p className="mt-1 text-ink-soft">
                    {address?.name}, {address?.line1}, {address?.city}, {address?.state}{" "}
                    <span className="tabular">{address?.postalCode}</span>
                  </p>
                  <p className="mt-1 tabular text-ink-faint">{o.guestPhone}</p>
                </div>
              </div>

              <div className="border-t border-[--color-rule] p-3.5">
                <OrderStatusForm orderId={o.id} current={o.status} tracking={o.trackingNumber} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
