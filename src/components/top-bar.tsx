"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TopBarMessage } from "@/lib/site-content";

/**
 * The storefront's top bar (Settings → Top bar). Wide screens show every
 * message in one line; narrow ones show one at a time, changing every few
 * seconds. The rotation stops while the pointer or keyboard focus is on it,
 * has a pause button (WCAG 2.2.2), and never starts for people who have
 * asked their device for reduced motion; they get arrows instead. Screen
 * readers get the whole list once, not a live region that keeps talking.
 */
export function TopBar({ messages }: { messages: TopBarMessage[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const count = messages.length;

  useEffect(() => {
    if (count < 2 || paused || hovered) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), 4500);
    return () => window.clearInterval(timer);
  }, [count, paused, hovered]);

  if (count === 0) return null;
  const current = messages[index % count];

  const text = (m: TopBarMessage) =>
    m.href ? (
      <Link href={m.href} className="underline-offset-2 hover:underline">
        {m.text}
      </Link>
    ) : (
      m.text
    );

  return (
    <section aria-label="Store announcements" className="bg-inverse text-micro font-semibold text-on-inverse">
      {/* Wide screens: all of them. */}
      <ul className="mx-auto hidden max-w-6xl items-center justify-center gap-x-3 px-5 py-1.5 lg:flex">
        {messages.map((m, i) => (
          <li key={m.id} className="flex items-center gap-3">
            {i > 0 && <span aria-hidden="true">·</span>}
            {text(m)}
          </li>
        ))}
      </ul>

      {/* Narrow screens: one at a time. */}
      <div
        className="flex items-center justify-center gap-1 px-2 py-1 lg:hidden"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        <ul className="sr-only">
          {messages.map((m) => (
            <li key={m.id}>{text(m)}</li>
          ))}
        </ul>
        {count > 1 && (
          <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center" onClick={() => setIndex((i) => (i - 1 + count) % count)} aria-label="Previous announcement">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        )}
        <p aria-hidden="true" className="min-w-0 flex-1 truncate text-center">
          {current.href ? (
            <Link href={current.href} tabIndex={-1} className="underline-offset-2 hover:underline">
              {current.text}
            </Link>
          ) : (
            current.text
          )}
        </p>
        {count > 1 && (
          <>
            <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center" onClick={() => setIndex((i) => (i + 1) % count)} aria-label="Next announcement">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Play announcements" : "Pause announcements"}
              aria-pressed={paused}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                {paused ? <path d="M7 4l13 8-13 8z" /> : <path d="M6 4h4v16H6zM14 4h4v16h-4z" />}
              </svg>
            </button>
          </>
        )}
      </div>
    </section>
  );
}
