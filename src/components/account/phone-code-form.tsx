"use client";

import { useEffect, useRef, useState } from "react";
import { confirmSignInCode, requestSignInCode } from "@/app/account/actions";
import { Turnstile } from "@/components/turnstile";

/**
 * Mobile number → 6-digit code, for signing in and for confirming a cash on
 * delivery order. With `sent` it opens straight at the code (checkout has
 * already sent one for the number it has); without, it asks for the number
 * first.
 */

export interface CodeSent {
  readonly phone: string;
  readonly sentTo: string;
  readonly resendIn: number;
  /** Only on the owner's own machine with no SMS provider: the code itself. */
  readonly demoCode?: string;
  /** Shown above the code box, e.g. "A code was sent a moment ago." */
  readonly note?: string;
}

export function PhoneCodeForm({
  sent: initialSent,
  submitLabel,
  onVerified,
  onChangeNumber,
  autoFocus = true,
  turnstileSiteKey = null,
}: {
  sent?: CodeSent;
  submitLabel: string;
  onVerified: () => void | Promise<void>;
  /** Checkout owns the number, so "Change number" goes back to its contact step. */
  onChangeNumber?: () => void;
  autoFocus?: boolean;
  /** Set when Cloudflare Turnstile is on: sending a code needs a human check. */
  turnstileSiteKey?: string | null;
}) {
  const [phone, setPhone] = useState(initialSent?.phone ?? "");
  const [sent, setSent] = useState<CodeSent | null>(initialSent ?? null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(initialSent?.resendIn ?? 0);
  const codeRef = useRef<HTMLInputElement>(null);
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const [humanReset, setHumanReset] = useState(0);
  const needsHuman = Boolean(turnstileSiteKey) && !humanToken;

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  useEffect(() => {
    if (sent && autoFocus) codeRef.current?.focus();
  }, [sent, autoFocus]);

  async function send(number: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await requestSignInCode(number, humanToken);
      // A token works once: get a fresh one for a resend.
      if (turnstileSiteKey) setHumanReset((n) => n + 1);
      if (result.ok) {
        setSent({ phone: number, sentTo: result.sentTo, resendIn: result.resendIn, demoCode: result.demoCode });
        setWait(result.resendIn);
        setCode("");
      } else if (result.resendIn && sent) {
        setWait(result.resendIn);
        setError(result.message);
      } else {
        setError(result.message);
      }
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!sent) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      codeRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await confirmSignInCode(sent.phone, code);
      if (!result.ok) {
        setError(result.message);
        if (result.expired) setWait(0);
        setBusy(false);
        return;
      }
      await onVerified();
    } catch {
      setError("No connection. Check your network and try again.");
    }
    setBusy(false);
  }

  if (!sent) {
    return (
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(phone);
        }}
      >
        <div>
          <label className="label" htmlFor="signin-phone">Mobile number</label>
          <input
            id="signin-phone"
            className="field max-w-xs"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoFocus={autoFocus}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? "signin-error" : undefined}
          />
        </div>
        <Turnstile siteKey={turnstileSiteKey} action="sms-code" onToken={setHumanToken} resetKey={humanReset} />
        <button type="submit" disabled={busy || needsHuman} className="btn btn-solid justify-self-start">
          {busy ? "Sending…" : "Send code"}
        </button>
        <p className="text-micro text-ink-faint">We&rsquo;ll text you a 6-digit code. No password to remember.</p>
        <div aria-live="polite" role="status">
          {error && <p id="signin-error" className="text-small text-alert">{error}</p>}
        </div>
      </form>
    );
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        confirm();
      }}
    >
      {sent.note && <p className="text-small text-ink-soft">{sent.note}</p>}
      {sent.demoCode && (
        <p className="border-l-4 border-strong bg-shelf px-3 py-2 text-small">
          <strong>Demo:</strong> no text message is sent on this computer. The code is{" "}
          <span className="tabular font-bold tracking-widest">{sent.demoCode}</span>.
        </p>
      )}
      <div>
        <label className="label" htmlFor="signin-code">
          Code sent to <span className="tabular">{sent.sentTo}</span>
        </label>
        <input
          ref={codeRef}
          id="signin-code"
          className="field max-w-[12rem] tabular tracking-[0.3em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
            if (error) setError(null);
          }}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? "signin-code-error" : undefined}
        />
      </div>
      <button type="submit" disabled={busy} className="btn btn-solid justify-self-start">
        {busy ? "Checking…" : submitLabel}
      </button>
      <div aria-live="polite" role="status">
        {error && <p id="signin-code-error" className="text-small text-alert">{error}</p>}
      </div>
      {wait <= 0 && <Turnstile siteKey={turnstileSiteKey} action="sms-code" onToken={setHumanToken} resetKey={humanReset} />}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-small">
        <button type="button" className="underline disabled:no-underline disabled:text-ink-faint" disabled={busy || wait > 0 || needsHuman} onClick={() => send(sent.phone)}>
          {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
        </button>
        <button
          type="button"
          className="underline"
          onClick={() => {
            if (onChangeNumber) return onChangeNumber();
            setSent(null);
            setCode("");
            setError(null);
          }}
        >
          Change number
        </button>
      </div>
    </form>
  );
}
