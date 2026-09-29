"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";

export type AdminNavGroup = { group: string | null; items: { href: string; label: string }[] };

function matches(path: string, href: string): boolean {
  return href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`);
}

/** The most specific link wins: /admin/analytics/risk lights "RTO risk", not "Analytics" too. */
function isActive(path: string, href: string, all: readonly string[]): boolean {
  return matches(path, href) && !all.some((other) => other !== href && other.length > href.length && matches(path, other));
}

/**
 * The console's page links. The highlight is worked out here, in the browser,
 * from the address: the layout around it isn't re-rendered when moving between
 * pages, so a highlight set on the server would stay on the first page opened.
 * A clicked link lights up at once, while a slow page (analytics, say) loads.
 */
export function AdminNav({ groups }: { groups: AdminNavGroup[] }) {
  const path = usePathname();
  // The link clicked on this page; forgotten as soon as the address changes.
  const [clicked, setClicked] = useState<{ href: string; from: string } | null>(null);
  const pendingHref = clicked && clicked.from === path ? clicked.href : null;
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  return (
    <nav aria-label="Owner console" className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-4 lg:block lg:flex-1 lg:overflow-y-auto lg:px-3">
      {groups.map((g) => (
        <div key={g.group ?? "home"} className="lg:mb-4">
          {g.group && <p className="hidden px-2 pb-1 text-micro font-semibold tracking-wide text-ink-faint uppercase lg:block">{g.group}</p>}
          <ul className="flex flex-wrap gap-x-4 lg:block">
            {g.items.map((item) => {
              const current = isActive(path, item.href, hrefs);
              // Looks active at once when clicked; announced as the current page once it is.
              const active = pendingHref ? item.href === pendingHref : current;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    onClick={(e) => {
                      // A new-tab click leaves this page where it is.
                      if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) setClicked({ href: item.href, from: path });
                    }}
                    className={`block py-1.5 text-small lg:px-2 ${active ? "font-semibold text-ink lg:bg-elevated" : "text-ink-soft hover:text-ink"}`}
                    style={active ? { borderRadius: "var(--radius-panel)" } : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
