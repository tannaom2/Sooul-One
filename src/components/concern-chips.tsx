import Link from "next/link";
import type { FilterOption } from "@/lib/concern-filter";

/**
 * Filter chips for a brand page. Plain links, so a filtered page is a URL a
 * shopper can share (WhatsApp is how products get passed around here) and it
 * works before any JavaScript loads.
 */
export function ConcernChips({
  label,
  basePath,
  options,
  active,
  total,
  accent,
}: {
  label: string;
  basePath: string;
  options: readonly FilterOption[];
  active: string | null;
  total: number;
  accent: string;
}) {
  if (options.length < 2) return null;
  const chip = (href: string, text: string, count: number, isActive: boolean) => (
    <Link
      key={href}
      href={href}
      scroll={false}
      // Swapping filters is refining one view, not new pages, so Back leaves the page
      // instead of stepping through every chip tapped.
      replace
      aria-current={isActive ? "page" : undefined}
      className={`shrink-0 border px-3 py-1.5 text-small whitespace-nowrap ${isActive ? "font-semibold text-paper" : "border-rule text-ink-soft hover:border-ink hover:text-ink"}`}
      style={{ borderRadius: 999, ...(isActive && { background: accent, borderColor: accent }) }}
    >
      {text} <span className={isActive ? "opacity-80" : "text-ink-faint"}>{count}</span>
    </Link>
  );

  return (
    <nav aria-label={label} className="border-b border-rule">
      <div className="mx-auto max-w-6xl px-5 py-4">
        <p className="mb-2 text-micro font-semibold tracking-wide text-ink-faint uppercase">{label}</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {chip(basePath, "All", total, active === null)}
          {options.map((o) => chip(`${basePath}?concern=${o.slug}`, o.name, o.count, o.slug === active))}
        </div>
      </div>
    </nav>
  );
}
