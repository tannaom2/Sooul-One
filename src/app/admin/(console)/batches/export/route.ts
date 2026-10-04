import { NextResponse } from "next/server";
import { audit, requirePermission } from "@/lib/auth";
import { istDate, stockCsv } from "@/lib/exports";
import { stockForExport } from "@/server/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stock as a spreadsheet (benchmark gap M2): every batch still holding stock,
 * soonest best-before first, or every batch with ?all=1. No customer data, so
 * anyone who manages batches can download it without the authenticator step.
 */
export async function GET(request: Request) {
  const session = await requirePermission("batches:write");
  if (!session) return NextResponse.json({ message: "Your role can't download stock." }, { status: 403 });
  const all = new URL(request.url).searchParams.get("all") === "1";
  const now = new Date();
  const rows = await stockForExport(all);
  await audit(session, "EXPORT_STOCK", "ProductBatch", "-", { rows: rows.length, all });
  return new NextResponse(stockCsv(rows, now), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stock-${all ? "all-batches" : "in-stock"}-${istDate(now)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
