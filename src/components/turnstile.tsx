"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile widget (server side: src/lib/turnstile.ts). Renders
 * nothing when no site key is given, so it's safe to place unconditionally.
 * The script loads once, when the widget first mounts; strict-dynamic in the
 * CSP lets this nonce-bearing bundle add it.
 */

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, options: Record<string, unknown>): string;
      reset(id?: string): void;
      remove(id?: string): void;
    };
  }
}

const SCRIPT_ID = "cf-turnstile";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load")), { once: true });
  });
}

export function Turnstile({
  siteKey,
  action,
  onToken,
  resetKey = 0,
}: {
  siteKey: string | null;
  /** Checked server-side, so a token from one form can't be used on another. */
  action: string;
  onToken: (token: string | null) => void;
  /** Change it to get a fresh token (tokens are single-use). */
  resetKey?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callback = useRef(onToken);
  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action,
          theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
          callback: (token: string) => callback.current(token),
          "expired-callback": () => callback.current(null),
          "error-callback": () => callback.current(null),
        });
      })
      .catch(() => callback.current(null));
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (resetKey && widget.current) {
      callback.current(null);
      window.turnstile?.reset(widget.current);
    }
  }, [resetKey]);

  if (!siteKey) return null;
  return <div ref={box} className="min-h-[65px]" />;
}
