import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { pickList, slipLines } from "@/lib/packing";
import { packingQueue } from "@/server/packing";
import { getBusinessProfile } from "@/server/business";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pick list and packing slips" };

/**
 * The packing run on paper: the pick list first, then one packing slip per
 * parcel, each on its own page. The slip goes in the parcel: the address,
 * what's in it with batch numbers (so the customer can check them on
 * /verify), and what to pay the courier on a cash order. The console's
 * sidebar and tabs don't print.
 */
export default async function PackingPrint({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const session = await requirePermission("orders:view");
  if (!session) return <NoAccess />;
  const ids = ((await searchParams).ids ?? "").split(",").filter((s) => /^[A-Za-z0-9_-]{1,40}$/.test(s)).slice(0, 100);
  if (ids.length === 0) return <Empty title="No orders chosen" detail="Tick orders on the Packing tab, then print." />;
  const [orders, business] = await Promise.all([packingQueue(ids), getBusinessProfile()]);
  if (orders.length === 0) return <Empty title="Nothing left to pack" detail="These orders have been shipped or closed since." />;
  const picks = pickList(orders.map((o) => ({ id: o.id, orderNumber: o.orderNumber, lines: o.lines })));
  const site = (process.env.SITE_URL ?? "http://localhost:3000").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const help = [business.customerCarePhone, business.customerCareEmail].filter(Boolean).join(" · ");

  return (
    <div className="grid max-w-3xl gap-8 print:max-w-none print:gap-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-h2 font-extrabold">Pick list and {orders.length} packing {orders.length === 1 ? "slip" : "slips"}</h1>
        <PrintButton />
      </div>

      <section className="panel print:break-after-page print:border-0">
        <div className="panel-head flex justify-between">
          <span>Pick list · {orders.length} {orders.length === 1 ? "order" : "orders"}</span>
          <span className="text-micro font-normal">{formatDate(new Date())}</span>
        </div>
        <table className="w-full text-small">
          <thead>
            <tr className="text-left text-micro text-ink-faint">
              <th className="px-3.5 py-2">Product</th>
              <th className="px-3.5 py-2 text-right">Units</th>
              <th className="px-3.5 py-2">Batch</th>
              <th className="px-3.5 py-2 text-right">Orders</th>
              <th className="px-3.5 py-2 text-right">Done</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p) => (
              <tr key={`${p.name}|${p.batchNumber}`} className="border-t border-rule">
                <td className="px-3.5 py-2">{p.name}</td>
                <td className="tabular px-3.5 py-2 text-right font-bold">{p.units}</td>
                <td className="tabular px-3.5 py-2">{p.batchNumber ?? "any"}</td>
                <td className="tabular px-3.5 py-2 text-right">{p.orders}</td>
                <td className="px-3.5 py-2 text-right" aria-hidden>
                  ☐
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {orders.map((o) => (
        <section key={o.id} className="panel break-inside-avoid p-5 print:break-after-page print:border-0 print:last:break-after-auto">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-3">
            <p className="font-display text-lead font-bold">{business.tradeName ?? "SooulOne"}</p>
            <p className="tabular text-small">
              Order {o.orderNumber} · {formatDate(o.placedAt)}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap justify-between gap-6">
            <div className="text-small">
              <p className="text-micro font-semibold tracking-wide text-ink-faint uppercase">Deliver to</p>
              <p className="mt-1 font-semibold">{o.address.name}</p>
              <p>{o.address.line1}</p>
              {o.address.line2 && <p>{o.address.line2}</p>}
              <p>
                {o.address.city}, {o.address.state} <span className="tabular">{o.address.postalCode}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-micro font-semibold tracking-wide text-ink-faint uppercase">{o.cod ? "Collect on delivery" : "Paid online"}</p>
              <p className="tabular mt-1 font-display text-h2 font-extrabold">{o.cod ? formatINR(o.totalPaise) : "Nothing to collect"}</p>
            </div>
          </div>
          <table className="mt-5 w-full text-small">
            <thead>
              <tr className="text-left text-micro text-ink-faint">
                <th className="py-1.5">In this parcel</th>
                <th className="py-1.5 text-right">Qty</th>
                <th className="py-1.5 pl-4">Batch</th>
              </tr>
            </thead>
            <tbody>
              {slipLines(o.lines).map((l) => (
                <tr key={`${l.productId}|${l.batchNumber}`} className="border-t border-rule">
                  <td className="py-1.5">{l.name}</td>
                  <td className="tabular py-1.5 text-right">{l.quantity}</td>
                  <td className="tabular py-1.5 pl-4">{l.batchNumber ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-5 border-t border-rule pt-3 text-micro text-ink-soft">
            Check any pack&apos;s batch at {site}/verify. {help ? `Questions or a problem with your order: ${help}.` : ""}
          </p>
        </section>
      ))}
    </div>
  );
}
