"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { consoleSearch, type SearchHit } from "./search-actions";

type Page = { href: string; label: string; group: string | null };
type Item = { key: string; kind: string; label: string; detail: string; href: string };

/**
 * Ctrl+K (or ⌘K) anywhere in the console (benchmark gap M13): type to jump
 * to a page, an order (number, phone or name), a product, a batch or a
 * supplier. Arrow keys move, Enter opens, Esc closes. Pages come from the
 * sidebar this role sees; records from consoleSearch, which checks the role
 * again.
 */
export function CommandMenu({ pages }: { pages: Page[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // Records, a moment after typing stops.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      const found = await consoleSearch(q);
      if (live) {
        setHits(found);
        setSearching(false);
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, open]);

  const items: Item[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pageItems = pages
      .filter((p) => !q || p.label.toLowerCase().includes(q) || (p.group ?? "").toLowerCase().includes(q))
      .slice(0, q ? 6 : 12)
      .map((p) => ({ key: `page:${p.href}`, kind: "Page", label: p.label, detail: p.group ?? "", href: p.href }));
    const recordItems = q.length >= 2 ? hits.map((h) => ({ key: `${h.kind}:${h.href}`, kind: h.kind, label: h.label, detail: h.detail, href: h.href })) : [];
    return [...pageItems, ...recordItems];
  }, [pages, hits, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setActive(0);
  };
  const go = (item: Item | undefined) => {
    if (!item) return;
    close();
    router.push(item.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 border border-rule bg-surface px-3 py-1.5 text-small text-ink-soft hover:text-ink"
        style={{ borderRadius: "var(--radius-panel)" }}
      >
        <span>Search…</span>
        <kbd className="text-micro text-ink-faint">Ctrl K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div role="dialog" aria-modal="true" aria-label="Search the console" className="w-full max-w-xl border border-rule bg-elevated shadow-elevated" style={{ borderRadius: "var(--radius-panel)" }}>
            <input
              ref={input}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                if (e.target.value.trim().length < 2) setHits([]);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
                else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(items.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  go(items[active]);
                }
              }}
              placeholder="Go to a page, or find an order, product, batch or supplier…"
              aria-label="Search"
              aria-controls="command-results"
              aria-activedescendant={items[active] ? `cmd-${active}` : undefined}
              className="w-full border-b border-rule bg-transparent px-4 py-3 text-lead outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            <ul id="command-results" role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
              {items.map((item, i) => (
                <li
                  key={item.key}
                  id={`cmd-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(item);
                  }}
                  className={`flex cursor-pointer items-baseline justify-between gap-3 px-4 py-2 text-small ${i === active ? "bg-shelf" : ""}`}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{item.label}</span>
                    {item.detail && <span className="text-ink-faint"> · {item.detail}</span>}
                  </span>
                  <span className="shrink-0 text-micro text-ink-faint">{item.kind}</span>
                </li>
              ))}
              {items.length === 0 && (
                <li className="px-4 py-3 text-small text-ink-faint">{searching ? "Searching…" : query.trim().length >= 2 ? "Nothing found." : "Type to search."}</li>
              )}
            </ul>
            <p className="border-t border-rule px-4 py-2 text-micro text-ink-faint">↑ ↓ to move · Enter to open · Esc to close</p>
          </div>
        </div>
      )}
    </>
  );
}
