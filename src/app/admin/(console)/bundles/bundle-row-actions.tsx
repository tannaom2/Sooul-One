"use client";

import { useTransition } from "react";
import { toggleBundle, deleteBundle } from "./actions";

export function BundleRowActions({ bundleId, isActive }: { bundleId: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-2">
      <button
        onClick={() => startTransition(() => toggleBundle(bundleId, !isActive))}
        disabled={pending}
        className="btn btn-outline px-3 py-1.5 text-small"
      >
        {isActive ? "Deactivate" : "Activate"}
      </button>
      <button
        onClick={() => {
          if (confirm("Delete this bundle? This can't be undone.")) {
            startTransition(() => deleteBundle(bundleId));
          }
        }}
        disabled={pending}
        className="btn btn-outline px-3 py-1.5 text-small text-alert"
      >
        Delete
      </button>
    </div>
  );
}
