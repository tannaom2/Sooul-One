"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkSetOrderStatus } from "../actions";

export interface OrderRow {
  id: string;
  orderNumber: string;
  name: string;
  items: number;
  placed: string;
  postalCode: string | null;
  status: string;
  statusLabel: string;
  risk: number | null;
  pays: string;
  total: string;
}

const GRID = "sm:grid-cols-[9rem_1fr_7.5rem_5.5rem_6rem]";

/**
 * The orders list's rows. Staff who can change orders tick several and move
 * them together (benchmark gap M2): "Start packing" for paid orders, "Mark
 * delivered" for shipped ones. Each goes through the same change as the order
 * page (bulkSetOrderStatus). The owner can also download the ticked ones.
 */
export function OrderRows({ rows, canWrite, canExport }: { rows: OrderRow[]; canWrite: boolean; canExport: boolean }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();
  const selectable = canWrite || canExport;
  const chosen = rows.filter((r) => picked.has(r.id));
  const paid = chosen.filter((r) => r.status === "PAID").length;
  const shipped = chosen.filter((r) => r.status === "SHIPPED").length;
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const run = (status: "PROCESSING" | "DELIVERED") =>
    start(async () => {
      const r = await bulkSetOrderStatus([...picked], status);
      setResult({ ok: r.ok, message: r.message ?? "" });
      setPicked(new Set());
      router.refresh();
    });

  return (
    <div className="panel">
      {/* Same structure as a row below, so the columns line up. */}
      <div className="hidden items-stretch border-b border-rule text-micro font-semibold text-ink-faint sm:flex">
        {selectable && (
          <label className="flex shrink-0 cursor-pointer items-center pl-4">
            <input
              type="checkbox"
              aria-label="Select every order on this page"
              checked={rows.length > 0 && picked.size === rows.length}
              onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
            />
          </label>
        )}
        <div aria-hidden className={`grid flex-1 gap-x-4 px-4 py-2 ${GRID}`}>
          <span>Order</span>
          <span>Customer · placed</span>
          <span>Status</span>
          <span>Pays</span>
          <span className="text-right">Total</span>
        </div>
      </div>

      {selectable && (picked.size > 0 || result) && (
        <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-shelf px-4 py-2.5 text-small" aria-live="polite">
          {picked.size > 0 && (
            <>
              <span className="font-semibold">{picked.size} selected</span>
              {canWrite && (
                <button type="button" className="btn btn-solid px-3 py-1.5 text-small" disabled={pending || paid === 0} onClick={() => run("PROCESSING")}>
                  {pending ? "Working…" : `Start packing${paid ? ` (${paid})` : ""}`}
                </button>
              )}
              {canWrite && (
                <button type="button" className="btn btn-outline px-3 py-1.5 text-small" disabled={pending || shipped === 0} onClick={() => run("DELIVERED")}>
                  {`Mark delivered${shipped ? ` (${shipped})` : ""}`}
                </button>
              )}
              {canExport && (
                <a href={`/admin/activity/export/orders?ids=${[...picked].join(",")}`} className="text-small underline">
                  Download as CSV
                </a>
              )}
              <button type="button" className="text-micro text-ink-faint underline" onClick={() => setPicked(new Set())}>
                Clear
              </button>
            </>
          )}
          {result && picked.size === 0 && <span className={result.ok ? "text-veg" : "text-alert"}>{result.message}</span>}
        </div>
      )}

      {rows.map((o) => (
        <div key={o.id} className={`flex items-stretch border-b border-rule last:border-b-0 hover:bg-shelf ${picked.has(o.id) ? "bg-shelf" : ""}`}>
          {selectable && (
            <label className="flex shrink-0 cursor-pointer items-center pl-4">
              <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Select ${o.orderNumber}`} />
            </label>
          )}
          <Link href={`/admin/orders/${o.id}`} className={`grid min-w-0 flex-1 gap-x-4 gap-y-0.5 px-4 py-3 text-small ${GRID} sm:items-center`}>
            <span className="tabular font-semibold">{o.orderNumber}</span>
            <span className="min-w-0 truncate text-ink-soft">
              {o.name}
              <span className="text-ink-faint">
                {" "}
                · {o.items} {o.items === 1 ? "item" : "items"} · {o.placed}
                {o.postalCode && <span className="tabular"> · {o.postalCode}</span>}
              </span>
            </span>
            <span className="text-ink-soft">
              {o.statusLabel}
              {o.risk !== null && <span className="block text-micro font-semibold text-alert">risk {o.risk}</span>}
            </span>
            <span className="text-ink-soft">{o.pays}</span>
            <span className="tabular font-semibold sm:text-right">{o.total}</span>
          </Link>
        </div>
      ))}
    </div>
  );
}
