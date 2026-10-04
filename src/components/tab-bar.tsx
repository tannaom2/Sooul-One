"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/components/basket/cart-provider";
import { showsTabBar } from "@/lib/tab-bar";

const ICONS = {
  home: "M3 11l9-7 9 7v9h-6v-6H9v6H3z",
  snacks: "M4 7h16l-1.5 12a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2zM8 7a4 4 0 0 1 8 0",
  gummies: "M8 3h8v3H8zM6 6h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM9 12h6",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5",
  basket: "M6 7h12l-1 13H7L6 7zM9 7a3 3 0 0 1 6 0",
} as const;

function Icon({ d }: { d: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * The storefront's bottom tab bar (Sprint 3): the shop's main places within
 * thumb reach on phones and upright tablets. Hidden from 1024px wide (a
 * laptop, or a tablet held sideways), where the header holds the same links
 * within easy reach. Not on pages with their own bottom bar or in checkout
 * (src/lib/tab-bar.ts). The same links as the header, so nothing is only on
 * one or the other.
 */
export function TabBar() {
  const path = usePathname();
  const { count, openBasket } = useCart();
  if (!showsTabBar(path)) return null;
  const tab = (href: string, label: string, d: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-12 flex-col items-center justify-center gap-0.5 text-micro ${active ? "font-bold text-ink" : "text-ink-soft"}`}
    >
      <Icon d={d} />
      <span>{label}</span>
    </Link>
  );
  return (
    <>
      {/* Room at the end of the page, so the footer isn't hidden behind the bar. */}
      <div aria-hidden className="h-[calc(4rem+env(safe-area-inset-bottom))] lg:hidden" />
      <nav
        aria-label="Shop"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-rule bg-paper/95 px-1 pt-1 backdrop-blur print:hidden lg:hidden"
        style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}
      >
        {tab("/", "Home", ICONS.home, path === "/")}
        {tab("/true-store", "True Store", ICONS.snacks, path.startsWith("/true-store"))}
        {tab("/gummies", "Gummies", ICONS.gummies, path.startsWith("/gummies"))}
        {tab("/search", "Search", ICONS.search, path.startsWith("/search"))}
        <button type="button" onClick={openBasket} className="flex min-h-12 flex-col items-center justify-center gap-0.5 text-micro text-ink-soft" aria-label={`Basket, ${count} ${count === 1 ? "item" : "items"}`}>
          <span className="relative flex">
            <Icon d={ICONS.basket} />
            {count > 0 && (
              <span className="tabular absolute -top-1.5 -right-2.5 rounded-full bg-inverse px-1.5 text-[11px] leading-4 font-semibold text-on-inverse">{count > 99 ? "99+" : count}</span>
            )}
          </span>
          <span>Basket</span>
        </button>
      </nav>
    </>
  );
}
