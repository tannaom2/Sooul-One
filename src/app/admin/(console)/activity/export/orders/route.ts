import { NextResponse } from "next/server";
import { audit, requirePermission } from "@/lib/auth";
import { stepUpExpiry } from "@/lib/step-up";
import { istDate, istMonth, ordersCsv } from "@/lib/exports";
import { ordersForExport } from "@/server/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IST_MS = 5.5 * 60 * 60 * 1000;
/** The start of an India-time day ("2026-09-14"), as a UTC instant. */
const istDay = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(Date.parse(`${d}T00:00:00Z`) - IST_MS) : null);

/**
 * Orders as a spreadsheet (benchmark gap M2): the ones ticked on the orders
 * list (?ids=), a date range (?from=&to=, India time, both days included), or
 * a month (?month=). Names, phones and addresses, so owner only, behind the
 * same fresh authenticator code as the activity log, and every download is
 * logged in Activity.
 */
export async function GET(request: Request) {
  const session = await requirePermission("finance:view");
  if (!session) return NextResponse.json({ message: "Only the owner can download orders." }, { status: 403 });
  const url = new URL(request.url);
  if (!(await stepUpExpiry(session))) {
    return NextResponse.redirect(new URL(`/admin/activity/verify?next=${encodeURIComponent(url.pathname + url.search)}`, request.url));
  }

  const ids = (url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{1,40}$/.test(s)).slice(0, 500);
  let scope: { ids: string[] } | { from: Date; to: Date };
  let label: string;
  if (ids.length) {
    scope = { ids };
    label = `selected-${ids.length}`;
  } else {
    const month = istMonth(url.searchParams.get("month") ?? "");
    const from = istDay(url.searchParams.get("from") ?? "");
    const toDay = istDay(url.searchParams.get("to") ?? "");
    if (month) {
      scope = month;
      label = url.searchParams.get("month")!;
    } else if (from && toDay && toDay >= from) {
      scope = { from, to: new Date(toDay.getTime() + 86_400_000) };
      label = `${istDate(from)}-to-${istDate(toDay)}`;
    } else {
      return NextResponse.json({ message: "Choose the orders: tick them on the orders list, or give a month or a from and to date." }, { status: 400 });
    }
  }

  const rows = await ordersForExport(scope);
  await audit(session, "EXPORT_ORDERS", "Order", "-", { rows: rows.length, scope: label });
  return new NextResponse(ordersCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-${label}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
