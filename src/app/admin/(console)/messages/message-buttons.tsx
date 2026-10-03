"use client";

import { useState, useTransition } from "react";
import { cancelMessage, retryMessage } from "./actions";

export function MessageButtons({ id, canRetry, canCancel }: { id: string; canRetry: boolean; canCancel: boolean }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  if (!canRetry && !canCancel) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRetry && (
        <button type="button" className="btn btn-outline" disabled={pending} onClick={() => start(async () => setNote(await retryMessage(id)))}>
          {pending ? "Sending…" : "Retry now"}
        </button>
      )}
      {canCancel && (
        <button
          type="button"
          className="btn btn-outline"
          disabled={pending}
          onClick={() => {
            if (confirm("Stop this message from being sent?")) start(async () => setNote(await cancelMessage(id)));
          }}
        >
          Cancel
        </button>
      )}
      {note && (
        <span role="status" className="text-micro" style={{ color: note.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
          {note.message}
        </span>
      )}
    </div>
  );
}
