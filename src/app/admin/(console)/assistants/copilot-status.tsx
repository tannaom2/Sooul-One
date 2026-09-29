"use client";

import { useCallback, useEffect, useState } from "react";

interface Status {
  configured: boolean;
  online: boolean;
  model: string | null;
  reason: string | null;
  checkedAt: string;
}

/** Online / Offline for the local copilot, checked on load, every 30 s, and on demand. */
export function CopilotStatus({ refreshKey = "" }: { refreshKey?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const r = await fetch("/api/admin/copilot/health", { cache: "no-store" });
      setStatus(r.ok ? await r.json() : null);
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(check, 0);
    const id = setInterval(check, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [check, refreshKey]);

  const label = !status
    ? checking
      ? "Checking…"
      : "Couldn't check"
    : status.online
      ? `Online${status.model ? ` · ${status.model}` : ""}`
      : status.configured
        ? `Offline: ${status.reason ?? "no answer"}`
        : "Not set up";
  return (
    <div className="flex flex-wrap items-center gap-3 text-small" role="status" aria-live="polite">
      <span className="flex items-center gap-2 font-semibold">
        <span aria-hidden className="inline-block h-2.5 w-2.5" style={{ borderRadius: 999, background: status?.online ? "var(--color-chart-good)" : "var(--color-chart-bad)" }} />
        {label}
      </span>
      {status && <span className="text-micro text-ink-faint">checked {new Date(status.checkedAt).toLocaleTimeString("en-IN", { timeStyle: "short" })}</span>}
      <button type="button" onClick={check} disabled={checking} className="text-small underline">
        Check now
      </button>
    </div>
  );
}
