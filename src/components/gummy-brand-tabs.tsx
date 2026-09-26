import Link from "next/link";
import { GUMMY_BRANDS } from "@/lib/gummy-brands";

/**
 * Switch between the gummies brands without going back to the gummies page:
 * "All gummies" plus one tab per brand, the current one marked. Plain links, so
 * each brand stays a URL a shopper can share.
 */
export function GummyBrandTabs({ active }: { active: string | null }) {
  const tab = (href: string, text: string, isActive: boolean, accent?: string) => (
    <Link
      key={href}
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`shrink-0 border-b-2 px-1 py-3 text-small whitespace-nowrap ${isActive ? "font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
      style={isActive ? { borderColor: accent ?? "currentColor" } : undefined}
    >
      {text}
    </Link>
  );

  return (
    <nav aria-label="Gummies brands" className="border-b border-rule">
      <div className="mx-auto flex max-w-6xl gap-6 overflow-x-auto px-5">
        {tab("/gummies", "All gummies", active === null)}
        {GUMMY_BRANDS.map((b) => tab(`/gummies/${b.slug}`, b.name, b.slug === active, b.accent))}
      </div>
    </nav>
  );
}
