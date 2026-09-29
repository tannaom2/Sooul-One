import { NextResponse } from "next/server";
import { audit, requirePermission } from "@/lib/auth";
import { stepUpExpiry } from "@/lib/step-up";
import { customerData } from "@/server/intel-reports";
import { churnCohort, consentedPhones } from "@/server/copilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quote a CSV cell, and stop spreadsheet apps treating a leading =, +, - or @ as a formula. */
function cell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * The lapsed high-value buyers from the Churn insight, as a CSV: personal
 * data, so owner only (settings:manage), behind the same fresh authenticator
 * code as the activity log (it lives under /admin/activity so that pass's
 * cookie reaches it), and every export is logged. The marketing-consent
 * column is there so offers go only to people who agreed.
 */
export async function GET(request: Request) {
  const session = await requirePermission("settings:manage");
  if (!session) return NextResponse.json({ message: "Only the owner can export customer lists." }, { status: 403 });
  if (!(await stepUpExpiry(session))) {
    return NextResponse.redirect(new URL("/admin/activity/verify?next=/admin/activity/export/churn", request.url));
  }

  const now = new Date();
  const { profiles } = await customerData(now);
  const cohort = churnCohort(profiles, now);
  const consent = await consentedPhones(cohort.map((p) => p.phone).filter((p): p is string => Boolean(p)));
  const day = (d: Date) => new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows = [
    ["Name", "Mobile", "Email", "Lifetime value (INR)", "Orders kept", "Last order", "Days since", "Agreed to offers"].map(cell).join(","),
    ...cohort.map((p) =>
      [
        p.name,
        p.phone,
        p.email,
        (p.ltvPaise / 100).toFixed(2),
        p.keptOrders,
        day(p.lastOrderAt),
        Math.floor((now.getTime() - p.lastOrderAt.getTime()) / 86_400_000),
        p.phone && consent.has(p.phone) ? "yes" : "no",
      ]
        .map(cell)
        .join(","),
    ),
  ];
  await audit(session, "EXPORT_CHURN_COHORT", "Customer", "-", { rows: cohort.length, withConsent: cohort.filter((p) => p.phone && consent.has(p.phone)).length });

  return new NextResponse(`﻿${rows.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lapsed-high-value-buyers-${day(now)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
