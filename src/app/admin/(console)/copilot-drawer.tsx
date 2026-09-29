"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Insight } from "@/lib/intel/insights-engine";
import { InsightCards } from "@/components/insight-cards";

/**
 * The Copilot drawer (docs/COPILOT.md). Questions go to /api/admin/copilot/chat,
 * which asks the owner's local model through its tunnel and falls back to the
 * built-in rules. Replies are shown as plain text, never as HTML, since a
 * model's output is untrusted.
 */

interface Status {
  configured: boolean;
  online: boolean;
  model: string | null;
  reason: string | null;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  insights?: readonly Insight[];
  source?: "llm" | "rules";
  note?: string | null;
}

const SUGGESTIONS = [
  "Which pincodes had high RTO?",
  "How are payments doing?",
  "Draft a re-engagement offer for inactive buyers",
  "Which orders should I confirm before packing?",
];

export function CopilotDrawer({ canAct, canConfigure }: { canAct: boolean; canConfigure: boolean }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const check = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/copilot/health", { cache: "no-store" });
      setStatus(r.ok ? await r.json() : { configured: false, online: false, model: null, reason: "Couldn't check" });
    } catch {
      setStatus({ configured: false, online: false, model: null, reason: "Couldn't check" });
    }
  }, []);

  // Check when opened, then every 30 seconds while open.
  useEffect(() => {
    if (!open) return;
    const first = setTimeout(check, 0);
    const id = setInterval(check, 30_000);
    input.current?.focus();
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [open, check]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        opener.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: q }]);
    setText("");
    setBusy(true);
    try {
      const r = await fetch("/api/admin/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history }),
      });
      const body = await r.json().catch(() => ({}));
      setTurns((t) => [
        ...t,
        r.ok
          ? { role: "assistant", content: body.reply, insights: body.insights, source: body.source, note: body.fallbackReason ? `Answered by the built-in rules because ${body.fallbackReason}.` : null }
          : { role: "assistant", content: body.message ?? "That didn't work. Try again.", source: "rules" },
      ]);
    } catch {
      setTurns((t) => [...t, { role: "assistant", content: "No connection. Check your network and try again.", source: "rules" }]);
    } finally {
      setBusy(false);
    }
  }

  const dot = !status ? "Checking…" : status.online ? `Online${status.model ? ` · ${status.model}` : ""}` : status.configured ? `Offline (${status.reason ?? "no answer"}): using built-in rules` : "Built-in rules (no local model set up)";

  return (
    <>
      <button
        ref={opener}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="btn btn-outline w-full justify-center px-3 py-1.5 text-small"
      >
        Ask Copilot
      </button>
      {open && (
        <div className="fixed inset-0 z-50 print:hidden">
          <button type="button" aria-label="Close Copilot" className="absolute inset-0 h-full w-full cursor-default bg-overlay" onClick={() => setOpen(false)} />
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="copilot-title"
            className="copilot-panel absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-elevated shadow-elevated"
          >
            <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
              <div>
                <h2 id="copilot-title" className="font-display text-h3 font-bold">
                  Copilot
                </h2>
                <p className="mt-0.5 flex items-center gap-2 text-micro text-ink-soft" role="status" aria-live="polite">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2"
                    style={{ borderRadius: 999, background: status?.online ? "var(--color-chart-good)" : "var(--color-chart-5)" }}
                  />
                  {dot}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-small underline">
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {turns.length === 0 && (
                <div className="grid gap-3">
                  <p className="text-small text-ink-soft">
                    Ask about the store. Your local model answers when it&apos;s online; otherwise the built-in rules do, from the same figures.
                    Only store totals are sent to it, never customers&apos; names or numbers.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} type="button" onClick={() => ask(s)} className="border border-rule px-2.5 py-1 text-left text-small hover:border-strong" style={{ borderRadius: 2 }}>
                        {s}
                      </button>
                    ))}
                  </div>
                  {canConfigure && !status?.configured && (
                    <p className="text-micro text-ink-faint">
                      Set up a local model in <Link href="/admin/assistants" className="underline">Settings → Assistants</Link>.
                    </p>
                  )}
                </div>
              )}
              <ol className="grid gap-4">
                {turns.map((t, i) => (
                  <li key={i} className={t.role === "user" ? "justify-self-end" : ""}>
                    <div
                      className={`max-w-[34rem] px-3 py-2 text-small whitespace-pre-wrap ${t.role === "user" ? "bg-inverse text-on-inverse" : "border border-rule bg-surface"}`}
                      style={{ borderRadius: "var(--radius-panel)" }}
                    >
                      {t.content}
                    </div>
                    {t.role === "assistant" && (
                      <p className="mt-1 text-micro text-ink-faint">
                        {t.source === "llm" ? "Local model" : "Built-in rules"}
                        {t.note ? ` · ${t.note}` : ""}
                      </p>
                    )}
                    {t.insights && t.insights.length > 0 && (
                      <div className="mt-2">
                        <InsightCards insights={t.insights} canAct={canAct} compact />
                      </div>
                    )}
                  </li>
                ))}
                {busy && (
                  <li className="text-small text-ink-soft" aria-live="polite">
                    Thinking…
                  </li>
                )}
              </ol>
              <div ref={endRef} />
            </div>

            <form
              className="flex gap-2 border-t border-rule p-4"
              onSubmit={(e) => {
                e.preventDefault();
                ask(text);
              }}
            >
              <label htmlFor="copilot-input" className="sr-only">
                Ask Copilot
              </label>
              <textarea
                id="copilot-input"
                ref={input}
                rows={2}
                maxLength={1000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(text);
                  }
                }}
                placeholder="Which pincodes had high RTO this week?"
                className="field flex-1 resize-none"
              />
              <button className="btn btn-solid px-4" disabled={busy || !text.trim()}>
                Ask
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
