"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { showsTabBar } from "@/lib/tab-bar";
import { formatDate } from "@/lib/format";
import { formatPriceTag } from "@/lib/money";
import type { BotBlock, BotReply, BotState, Intent, QuickReply } from "@/lib/assistant";

/**
 * The storefront assistant: a Help button and a chat panel (a bottom sheet on
 * phones). Talks to /api/chatbot/message, which answers from store facts and
 * the owner's own words (src/lib/assistant.ts) and hands over to a person
 * when it doesn't know. Replies arrive as structured blocks (text, an order
 * timeline, a pincode card, contact options), so nothing is rendered as HTML.
 */

type Line = { from: "bot"; blocks: readonly BotBlock[] } | { from: "you"; text: string };

const PROMPT: Record<BotReply["expect"], { placeholder: string; inputMode: "text" | "numeric" | "email" }> = {
  orderNumber: { placeholder: "Order number, e.g. SO-XXXXXXXX-XX", inputMode: "text" },
  contact: { placeholder: "Mobile number or email", inputMode: "email" },
  pincode: { placeholder: "6-digit pincode", inputMode: "numeric" },
  text: { placeholder: "Type a question…", inputMode: "text" },
};

function Block({ block }: { block: BotBlock }) {
  switch (block.type) {
    case "text":
      return <p className="whitespace-pre-wrap">{block.text}</p>;
    case "timeline":
      return (
        <div>
          <p className="font-semibold">Order {block.orderNumber}</p>
          <ol className="mt-2 grid gap-1.5">
            {block.stages.map((s) => (
              <li key={s.label} className="flex items-center gap-2" aria-current={s.current ? "step" : undefined}>
                <span
                  aria-hidden
                  className={`grid h-5 w-5 shrink-0 place-items-center text-micro font-bold ${s.done ? "bg-primary text-on-primary" : "border border-rule text-ink-faint"}`}
                  style={{ borderRadius: 999 }}
                >
                  {s.done ? "✓" : ""}
                </span>
                <span className={s.current ? "font-bold" : s.done ? "" : "text-ink-faint"}>
                  {s.label}
                  <span className="sr-only">{s.done ? " (done)" : " (not yet)"}</span>
                </span>
                {s.date && <span className="ml-auto text-micro text-ink-soft">{formatDate(s.date)}</span>}
              </li>
            ))}
          </ol>
          {block.ended && (
            <p className="mt-2 font-semibold text-alert">
              {block.ended.label}
              {block.ended.date ? ` · ${formatDate(block.ended.date)}` : ""}
            </p>
          )}
          {block.tracking && (
            <p className="mt-2 text-micro text-ink-soft">
              {block.tracking.courier ? `${block.tracking.courier} ` : ""}tracking number <span className="tabular font-semibold text-ink">{block.tracking.number}</span>
            </p>
          )}
        </div>
      );
    case "pincode":
      return (
        <div>
          <p className="font-semibold">
            {block.pincode}
            {block.place ? ` · ${block.place}` : ""}
          </p>
          {block.serviceable ? (
            <ul className="mt-1.5 grid gap-1">
              <li>✓ We deliver here{block.arrivesBy ? `, by ${formatDate(block.arrivesBy)} if you order today` : ""}.</li>
              <li>
                {block.cod.allowed ? "✓ Cash on delivery available." : "✗ Cash on delivery isn't available here."}
                {block.cod.note ? ` ${block.cod.note}` : ""}
              </li>
              <li>
                Delivery {formatPriceTag(block.deliveryFeePaise)}, free over {formatPriceTag(block.freeAbovePaise)}.
              </li>
            </ul>
          ) : (
            <p className="mt-1.5">✗ We don&apos;t deliver to this pincode yet.</p>
          )}
        </div>
      );
    case "handoff":
      return (
        <div className="grid gap-2">
          {block.whatsapp && (
            <a href={block.whatsapp} target="_blank" rel="noopener noreferrer" className="btn btn-solid justify-center px-3 py-2 text-small">
              Message us on WhatsApp
            </a>
          )}
          {block.email && (
            <a href={`mailto:${block.email}`} className="btn btn-outline justify-center px-3 py-2 text-small">
              Email {block.email}
            </a>
          )}
          {block.phone && (
            <a href={`tel:${block.phone.replace(/[^\d+]/g, "")}`} className="text-center text-small underline">
              Call {block.phone}
            </a>
          )}
          {!block.whatsapp && !block.email && !block.phone && <p>Contact details will be here soon.</p>}
        </div>
      );
    case "links":
      return (
        <ul className="grid gap-1">
          {block.links.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="underline">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      );
  }
}

export function StorefrontBot() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [quick, setQuick] = useState<readonly QuickReply[]>([]);
  const [expect, setExpect] = useState<BotReply["expect"]>("text");
  const [state, setState] = useState<BotState>({ flow: null });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(payload: { intent?: Intent; text?: string }, echo?: string) {
    if (busy) return;
    if (echo) setLines((l) => [...l, { from: "you", text: echo }]);
    setBusy(true);
    setQuick([]);
    try {
      const r = await fetch("/api/chatbot/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, state: payload.intent ? undefined : state }),
      });
      const body = (await r.json().catch(() => null)) as BotReply | null;
      if (!r.ok || !body?.blocks) {
        setLines((l) => [...l, { from: "bot", blocks: [{ type: "text", text: r.status === 429 ? "That's a lot of messages. Wait a few minutes and try again." : "Something went wrong. Try again." }] }]);
        return;
      }
      setLines((l) => [...l, { from: "bot", blocks: body.blocks }]);
      setQuick(body.quickReplies);
      setExpect(body.expect);
      setState(body.state);
    } catch {
      setLines((l) => [...l, { from: "bot", blocks: [{ type: "text", text: "No connection. Check your network and try again." }] }]);
    } finally {
      setBusy(false);
    }
  }

  function openPanel() {
    setOpen(true);
    if (lines.length === 0) void send({ intent: "menu" });
  }

  function close() {
    setOpen(false);
    opener.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines, busy]);

  // Not on checkout (nothing should compete with paying), and not in the console.
  if (path.startsWith("/checkout") || path.startsWith("/admin")) return null;
  // Product and basket pages have a buy bar along the bottom on phones.
  // Above whatever sits at the bottom: a product's buy bar, the basket's bar, or the tab bar (src/lib/tab-bar.ts).
  const lifted = path.startsWith("/product/") || path === "/cart" || showsTabBar(path);
  // The box page's tray (count, price, Add box to basket, and the save form
  // after adding) is taller and changes height: the page measures it into
  // --box-tray (src/app/box/[slug]/box-builder.tsx) and the button sits 12 px above.
  const overTray = path.startsWith("/box/");
  const prompt = PROMPT[expect];

  return (
    <>
      {!open && (
        <button
          ref={opener}
          type="button"
          onClick={openPanel}
          aria-haspopup="dialog"
          className={`fixed right-4 z-50 flex items-center gap-2 bg-inverse px-4 py-2.5 text-small font-semibold text-on-inverse shadow-elevated print:hidden lg:bottom-6 ${overTray ? "bottom-[calc(var(--box-tray,160px)_+_12px)]" : lifted ? "bottom-24" : "bottom-4"}`}
          style={{ borderRadius: 999 }}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" strokeLinejoin="round" />
          </svg>
          Help
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="SooulOne help"
          className="assistant-panel fixed inset-x-0 bottom-0 z-50 flex max-h-[85svh] flex-col border border-rule bg-elevated shadow-elevated print:hidden sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[23rem] sm:max-h-[36rem]"
          style={{ borderRadius: "var(--radius-panel)" }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
            <div>
              <p className="font-display font-bold">SooulOne help</p>
              <p className="text-micro text-ink-faint">Answers from our store. A person is a tap away.</p>
            </div>
            <button type="button" onClick={close} className="px-2 py-1 text-small underline">
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 text-small" aria-live="polite">
            <ol className="grid gap-3">
              {lines.map((line, i) =>
                line.from === "you" ? (
                  <li key={i} className="max-w-[85%] justify-self-end bg-inverse px-3 py-2 text-on-inverse" style={{ borderRadius: "var(--radius-panel)" }}>
                    {line.text}
                  </li>
                ) : (
                  <li key={i} className="grid max-w-[92%] gap-2 border border-rule bg-surface px-3 py-2" style={{ borderRadius: "var(--radius-panel)" }}>
                    {line.blocks.map((b, j) => (
                      <Block key={j} block={b} />
                    ))}
                  </li>
                ),
              )}
              {busy && <li className="text-ink-soft">…</li>}
            </ol>
            {quick.length > 0 && !busy && (
              <div className="mt-3 flex flex-wrap gap-2">
                {quick.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => send({ intent: q.intent }, q.label)}
                    className="border border-strong px-2.5 py-1 text-small hover:bg-shelf"
                    style={{ borderRadius: 999 }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="flex gap-2 border-t border-rule p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const t = text.trim();
              if (!t) return;
              setText("");
              // A mobile number or email is shown masked in the chat, not repeated in full.
              const echo = expect === "contact" ? (t.includes("@") ? t.replace(/^(.).*(@.*)$/, "$1•••$2") : t.replace(/\d(?=\d{3})/g, "•")) : t;
              void send({ text: t }, echo);
            }}
          >
            <label htmlFor="assistant-input" className="sr-only">
              {prompt.placeholder}
            </label>
            <input
              id="assistant-input"
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              inputMode={prompt.inputMode}
              autoComplete={expect === "contact" ? "email" : expect === "pincode" ? "postal-code" : "off"}
              maxLength={200}
              placeholder={prompt.placeholder}
              className="field flex-1"
            />
            <button className="btn btn-solid px-3" disabled={busy || !text.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
