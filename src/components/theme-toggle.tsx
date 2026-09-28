"use client";

import { useEffect, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, savedTheme, type ThemeName } from "@/lib/theme";

/**
 * The Day/Night switch: in the storefront header while the owner allows it
 * (Store controls), and always in the owner console's sidebar, each with its
 * own saved choice. The theme itself is set before the first paint by the
 * boot script in the root layout; this reads it from <html data-theme>,
 * flips it, and keeps the choice in this browser. Other open tabs follow.
 */

function current(): ThemeName {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function apply(theme: ThemeName) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

/** `storageKey`: the storefront's (default) or the owner console's (CONSOLE_THEME_STORAGE_KEY). */
export function ThemeToggle({ storageKey = THEME_STORAGE_KEY, className = "" }: { storageKey?: string; className?: string }) {
  // Null on the server: the saved choice lives only in the browser.
  const theme = useSyncExternalStore(subscribe, current, () => null);

  // A choice made in another tab applies here too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const next = e.key === storageKey ? savedTheme(e.newValue) : null;
      if (next) apply(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const toggle = () => {
    const next: ThemeName = current() === "dark" ? "light" : "dark";
    apply(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Storage blocked: the switch still works for this page.
    }
  };

  const label = theme === "dark" ? "Switch to Day mode" : "Switch to Night mode";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center hover:text-ink-soft ${className}`}
      style={{ borderRadius: "var(--radius-panel)" }}
    >
      {/* Same size before and after hydration, so the header never shifts. */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        {theme === "dark" ? (
          // Sun: tapping brings the day back.
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          // Moon.
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        )}
      </svg>
    </button>
  );
}
