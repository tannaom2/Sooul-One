"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyReferralCode } from "@/app/account/actions";

/** "Got a code from a friend?": for codes passed on by word of mouth rather than a link. */
export function ReferralCodeEntry({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-small underline">
        Got a referral code from a friend?
      </button>
    );
  }
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await applyReferralCode(code);
          setResult(r);
          if (r.ok) router.refresh();
        });
      }}
    >
      <label className="label" htmlFor="referral-code">
        Referral code
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="referral-code"
          className="field max-w-[12rem] uppercase tracking-wider"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
          maxLength={14}
          placeholder="ASHA7K2"
        />
        <button type="submit" disabled={pending || code.trim().length < 4} className="btn btn-outline px-4 py-2 text-small">
          {pending ? "Checking…" : "Apply"}
        </button>
      </div>
      <p aria-live="polite" role="status" className={`text-small ${result?.ok ? "text-veg" : "text-alert"}`}>
        {result?.message}
      </p>
    </form>
  );
}
