"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pickList, type PackLine } from "@/lib/packing";
import { bulkSetOrderStatus } from "../../actions";

type Row = { id: string; orderNumber: string; status: string; who: string; items: number; pays: string; waited: number; lines: PackLine[] };

/** How many of the oldest orders start ticked: a sensible first run. */
const FIRST_RUN = 5;

export function PackingBoard({ orders, canWrite }: { orders: Row[]; canWrite: boolean }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(orders.slice(0, FIRST_RUN).map((o) => o.id)));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();
  const chosen = orders.filter((o) => picked.has(o.id));
  const picks = useMemo(() => pickList(chosen.map((o) => ({ id: o.id, orderNumber: o.orderNumber, lines: o.lines }))), [chosen]);
  const units = picks.reduce((n, p) => n + p.units, 0);
  const paid = chosen.filter((o) => o.status === "PAID").length;
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const printHref = `/admin/orders/packing/print?ids=${chosen.map((o) => o.id).join(",")}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <section className="panel">
        <div className="panel-head flex flex-wrap items-center justify-between gap-2">
          <span>To pack, oldest first · {orders.length}</span>
          <span className="flex gap-3 text-micro font-normal">
            <button type="button" className="underline" onClick={() => setPicked(new Set(orders.map((o) => o.id)))}>
              Tick all
            </button>
            <button type="button" className="underline" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          </span>
        </div>
        <ul>
          {orders.map((o) => (
            <li key={o.id} className={`border-b border-rule last:border-b-0 ${picked.has(o.id) ? "bg-shelf" : ""}`}>
              <label className="grid cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-3 text-small">
                <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Pack ${o.orderNumber}`} />
                <span className="min-w-0">
                  <span className="tabular block font-semibold">{o.orderNumber}</span>
                  <span className="block truncate text-ink-soft">
                    {o.who} · {o.items} {o.items === 1 ? "item" : "items"}
                    {o.status === "PROCESSING" && <span className="text-ink-faint"> · packing</span>}
                  </span>
                </span>
                <span className="text-right">
                  <span className="tabular block font-semibold">{o.pays}</span>
                  <span className={`block text-micro ${o.waited >= 3 ? "font-semibold text-alert" : "text-ink-faint"}`}>
                    {o.waited === 0 ? "today" : `${o.waited} ${o.waited === 1 ? "day" : "days"}`}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-4">
        <div className="panel">
          <div className="panel-head flex flex-wrap items-baseline justify-between gap-2">
            <span>
              Pick list for {chosen.length} {chosen.length === 1 ? "order" : "orders"}
            </span>
            <span className="text-micro font-normal text-ink-faint">{units} units · from the batch set aside at checkout</span>
          </div>
          {picks.length === 0 ? (
            <p className="p-3.5 text-small text-ink-faint">Tick orders on the left to build the pick list.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-small">
                <thead>
                  <tr className="text-left text-micro text-ink-faint">
                    <th className="px-3.5 py-2 font-semibold">Product</th>
                    <th className="px-3.5 py-2 text-right font-semibold">Units</th>
                    <th className="px-3.5 py-2 font-semibold">Take from batch</th>
                  </tr>
                </thead>
                <tbody>
                  {picks.map((p) => (
                    <tr key={`${p.name}|${p.batchNumber}`} className="border-t border-rule">
                      <td className="px-3.5 py-2">{p.name}</td>
                      <td className="tabular px-3.5 py-2 text-right font-bold">{p.units}</td>
                      <td className="tabular px-3.5 py-2">{p.batchNumber ?? <span className="text-ink-faint">any</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a href={printHref} target="_blank" rel="noopener" aria-disabled={chosen.length === 0} className={`btn btn-solid ${chosen.length === 0 ? "pointer-events-none opacity-50" : ""}`}>
            Print pick list and {chosen.length} {chosen.length === 1 ? "slip" : "slips"}
          </a>
          {canWrite && (
            <button
              type="button"
              className="btn btn-outline"
              disabled={pending || paid === 0}
              onClick={() =>
                start(async () => {
                  const r = await bulkSetOrderStatus(chosen.filter((o) => o.status === "PAID").map((o) => o.id), "PROCESSING");
                  setResult({ ok: r.ok, message: r.message ?? "" });
                  router.refresh();
                })
              }
            >
              {pending ? "Working…" : `Start packing${paid ? ` (${paid})` : ""}`}
            </button>
          )}
        </div>
        {result && (
          <p role="status" className={`text-small ${result.ok ? "text-veg" : "text-alert"}`}>
            {result.message}
          </p>
        )}
        <p className="text-micro text-ink-faint">
          Mark each parcel shipped from its order page once the courier has it: the customer is emailed the tracking number.
        </p>
      </section>
    </div>
  );
}
