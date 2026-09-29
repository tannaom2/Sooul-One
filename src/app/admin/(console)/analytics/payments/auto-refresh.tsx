"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the report every so often while the tab is visible, so the page
 * can sit open on a screen during a sale. Off by default; the choice is
 * remembered on this device only.
 */

const KEY = "soulone-payments-refresh";
const EVENT = "soulone-payments-refresh";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(notify: () => void) {
  window.addEventListener(EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(EVENT, notify);
    window.removeEventListener("storage", notify);
  };
}

export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  const on = useSyncExternalStore(subscribe, read, () => false);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [on, seconds, router]);
  return (
    <label className="flex items-center gap-2 text-small">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          try {
            localStorage.setItem(KEY, e.target.checked ? "1" : "0");
          } catch {
            /* private window: nothing to remember it in */
          }
          window.dispatchEvent(new Event(EVENT));
        }}
      />
      Refresh every {seconds} s
    </label>
  );
}
