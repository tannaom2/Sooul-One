"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ANALYTICS_TABS } from "./tabs";



/** The report tabs. Worked out in the browser, like the console nav, so the highlight follows every click. */
export function AnalyticsTabs({ visible }: { visible: readonly string[] }) {
  const path = usePathname();
  const current = (href: string) => (href === "/admin/analytics" ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <nav aria-label="Reports" className="flex flex-wrap gap-1 border-b border-rule print:hidden">
      {ANALYTICS_TABS.filter((t) => visible.includes(t.href)).map((t) => (
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
