"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/analytics", label: "Overview" },
  { href: "/admin/analytics/pincodes", label: "Pincodes" },
  { href: "/admin/analytics/payments", label: "Payments" },
  { href: "/admin/analytics/customers", label: "Customers" },
  { href: "/admin/analytics/campaigns", label: "Campaigns" },
  { href: "/admin/analytics/risk", label: "RTO risk" },
  { href: "/admin/analytics/site", label: "Search and batches" },
] as const;

/** The report tabs. Worked out in the browser, like the console nav, so the highlight follows every click. */
export function AnalyticsTabs() {
  const path = usePathname();
  const current = (href: string) => (href === "/admin/analytics" ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <nav aria-label="Reports" className="flex flex-wrap gap-1 border-b border-rule print:hidden">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={current(t.href) ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-small ${current(t.href) ? "border-strong font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
