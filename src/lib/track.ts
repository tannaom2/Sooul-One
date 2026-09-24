import type { ClientEvent } from "./client-events";

/**
 * Record a storefront interaction from the browser.
 *
 * sendBeacon survives the page being closed or navigated away from, which is
 * exactly when checkout-step and cart events matter most; fetch with
 * keepalive is the fallback. Never throws and never blocks the UI.
 */
export function track(event: ClientEvent): void {
  try {
    const body = JSON.stringify(event);
    const blob = new Blob([body], { type: "application/json" });
    if (typeof navigator !== "undefined" && navigator.sendBeacon?.("/api/analytics/event", blob)) return;
    void fetch("/api/analytics/event", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
  } catch {
    // Tracking must never break the page.
  }
}
