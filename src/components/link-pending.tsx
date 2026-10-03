"use client";

import { useLinkStatus } from "next/link";

/**
 * Feedback the moment a product card is tapped, while the page loads
 * (benchmark gap F4b). Product pages can't have a loading.tsx: it would turn
 * a removed product's 404 into a 200 (tests/loading-boundaries.test.ts). So
 * the card itself says it's opening. Render inside the <Link>, which needs
 * `relative`.
 */
export function LinkPending({ label = "Opening…" }: { label?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      role="status"
      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface/70 text-small font-semibold"
      style={{ borderRadius: "var(--radius-panel)" }}
    >
      {label}
    </span>
  );
}
