"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GUMMY_BRANDS } from "@/lib/gummy-brands";

/**
 * The header links on a phone, where they don't fit in the bar. Closes when a
 * link is followed (the layout stays mounted across pages, so it would
 * otherwise stay open) and on Escape.
 */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();

  // Close after navigating: a new pathname means a link in the menu was followed.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const link = "block py-3 text-body font-medium";

  return (
    <div className="sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex h-11 w-11 items-center justify-center"
      >
        <span className="sr-only">{open ? "Close menu" : "Menu"}</span>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
        </svg>
      </button>

      {open && (
        <div id={panelId} className="absolute inset-x-0 top-full border-b border-rule bg-paper px-5 pb-4 shadow-sm">
          <nav aria-label="Menu" className="divide-y divide-rule">
            <Link href="/true-store" className={link}>
              The True Store
            </Link>
            <div>
              <Link href="/gummies" className={link}>
                Gummies
              </Link>
              <ul className="-mt-1 mb-2 grid gap-1 pl-4">
                {GUMMY_BRANDS.map((b) => (
                  <li key={b.slug}>
                    <Link href={`/gummies/${b.slug}`} className="block py-2 text-small text-ink-soft">
                      {b.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <Link href="/stores" className={link}>
              Find a store
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}
