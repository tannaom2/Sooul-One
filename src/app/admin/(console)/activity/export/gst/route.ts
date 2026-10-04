import { NextResponse } from "next/server";
import { audit, requirePermission } from "@/lib/auth";
import { stepUpExpiry } from "@/lib/step-up";
import { gstRegisterCsv, hsnSummaryCsv, istMonth } from "@/lib/exports";
import { invoicesForExport } from "@/server/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A month's GST invoices as a spreadsheet for the accountant (benchmark gap
 * M2): ?kind=register gives every invoice line (CGST, SGST or IGST), and
 * ?kind=hsn the totals per HSN code and rate for GSTR-1. Worked out by the
 * same code as the printed invoices (buildInvoice), so the two always agree.
 * Owner only, behind the authenticator step, logged in Activity.
 */
export async function GET(request: Request) {
  const session = await requirePermission("finance:view");
  if (!session) return NextResponse.json({ message: "Only the owner can download the GST register." }, { status: 403 });
  const url = new URL(request.url);
  if (!(await stepUpExpiry(session))) {
    return NextResponse.redirect(new URL(`/admin/activity/verify?next=${encodeURIComponent(url.pathname + url.search)}`, request.url));
  }
  const monthText = url.searchParams.get("month") ?? "";
  const month = istMonth(monthText);
  if (!month) return NextResponse.json({ message: "Choose a month, like 2026-09." }, { status: 400 });
  const kind = url.searchParams.get("kind") === "hsn" ? "hsn" : "register";

  const invoices = await invoicesForExport(month.from, month.to);
  await audit(session, kind === "hsn" ? "EXPORT_HSN_SUMMARY" : "EXPORT_GST_REGISTER", "Order", "-", { month: monthText, invoices: invoices.length });
  return new NextResponse(kind === "hsn" ? hsnSummaryCsv(invoices) : gstRegisterCsv(invoices), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind === "hsn" ? "hsn-summary" : "gst-register"}-${monthText}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
