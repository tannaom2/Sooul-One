import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { decimalToPaise, formatDate } from "@/lib/format";
import { ORDER_VIEWS, ORDERS_PAGE_SIZE, orderFiltersHref, parseOrderFilters, type OrderView } from "@/lib/order-filters";
import { reportError } from "@/lib/observability";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function Orders({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const session = await requirePermission("orders:view");
  if (!session) return <NoAccess />;

  const filters = parseOrderFilters(await searchParams);
  const { view, q, page } = filters;

  const search: Prisma.OrderWhereInput = q
    ? {
        OR: [
          { orderNumber: { contains: q, mode: "insensitive" } },
          { guestEmail: { contains: q, mode: "insensitive" } },
          { guestPhone: { contains: q } },
          { shippingAddress: { path: ["name"], string_contains: q } },
        ],
      }
    : {};
  const statuses = ORDER_VIEWS[view].statuses;
  const where: Prisma.OrderWhereInput = {
    ...search,
    ...(statuses && { status: { in: [...statuses] as any } }),
  };

  let orders: any[] = [];
  let total = 0;
  let byStatus: { status: string; _count: { _all: number } }[] = [];
  try {
    [orders, total, byStatus] = await Promise.all([
      db.order.findMany({
        where,
        include: { _count: { select: { items: true } } },
        orderBy: { placedAt: "desc" },
        take: ORDERS_PAGE_SIZE,
        skip: (page - 1) * ORDERS_PAGE_SIZE,
      }),
      db.order.count({ where }),
      // Tab counts respect the search, so "To ship (2)" means two matches.
      db.order.groupBy({ by: ["status"], where: search, _count: { _all: true } }) as any,
    ]);
  } catch (error) {
    reportError("admin/orders", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  const countFor = (v: OrderView) => {
    const s = ORDER_VIEWS[v].statuses;
    return byStatus.filter((r) => !s || (s as readonly string[]).includes(r.status)).reduce((n, r) => n + r._count._all, 0);
  };
  const pages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-h2 font-extrabold">Orders</h1>
        {/* Keyed on the filters so its fields reset when they change from outside it
            (a status tab, Clear, Back); defaultValue alone only applies on first mount. */}
        <form key={`${view}|${q}`} method="get" role="search" className="flex w-full gap-2 sm:w-auto">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <label htmlFor="order-search" className="sr-only">
            Search orders
          </label>
          <input
            id="order-search"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            placeholder="Order number, email, phone or name…"
            className="field min-w-0 flex-1 sm:w-72 sm:flex-none"
          />
          <button className="btn btn-outline px-4 py-2 text-small">Search</button>
        </form>
      </div>

      <nav aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto border-b border-rule pb-px">
        {(Object.keys(ORDER_VIEWS) as OrderView[]).map((v) => {
          const active = v === view;
          return (
            <Link
              key={v}
              href={orderFiltersHref({ view: v, q })}
              aria-current={active ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-small whitespace-nowrap ${
                active ? "border-ink font-semibold" : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {ORDER_VIEWS[v].label} <span className="tabular text-ink-faint">{countFor(v)}</span>
            </Link>
          );
        })}
      </nav>

      {orders.length === 0 ? (
        <Empty
          title={q || view !== "all" ? "No matching orders" : "No orders yet"}
          detail={
            q || view !== "all"
              ? "Try another search or status."
              : "Orders appear here the moment the first one is placed."
          }
        />
      ) : (
        <div className="panel">
          {orders.map((o) => {
            const address = o.shippingAddress as any;
            return (
              <Link
                key={o.id}
                href={`/admin/orders/${o.id}`}
                className="grid gap-x-4 gap-y-0.5 border-b border-rule px-4 py-3 text-small last:border-b-0 hover:bg-shelf sm:grid-cols-[10rem_1fr_7rem_6rem] sm:items-center"
              >
                <span className="tabular font-semibold">{o.orderNumber}</span>
                <span className="min-w-0 truncate text-ink-soft">
                  {address?.name ?? o.guestEmail}
                  <span className="text-ink-faint">
                    {" "}
                    · {o._count.items} {o._count.items === 1 ? "item" : "items"} · {formatDate(o.placedAt)}
                  </span>
                </span>
                <span className="text-ink-soft">{o.status.replace(/_/g, " ").toLowerCase()}</span>
                <span className="tabular font-semibold sm:text-right">{formatINR(decimalToPaise(o.totalAmount))}</span>
              </Link>
            );
          })}
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-4 text-small">
          {page > 1 && (
            <Link href={orderFiltersHref({ ...filters, page: page - 1 })} className="underline">
              Newer
            </Link>
          )}
          <span className="tabular text-ink-faint">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={orderFiltersHref({ ...filters, page: page + 1 })} className="underline">
              Older
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
