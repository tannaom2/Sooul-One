"use client";

import { useState } from "react";

/**
 * New recovery codes, shown the one time they exist in plain form. Copy puts
 * them all on the clipboard for a password manager; printing works too.
 */
export function RecoveryCodeList({ codes }: { codes: readonly string[] }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="border-l-4 border-caution bg-shelf p-3 text-small">
        <p className="font-semibold">Save these now. They won&apos;t be shown again.</p>
        <p className="mt-1 text-ink-soft">
          If you lose your phone, each code signs you in once in place of the 6-digit code. Keep them in a password
          manager or print them, somewhere other than your phone.
        </p>
      </div>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-2 border border-rule p-4 font-mono text-base tracking-wider">
        {codes.map((code) => (
          <li key={code} className="tabular select-all">
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3 print:hidden">
        <button type="button" onClick={copy} className="btn btn-outline">
          {copied ? "Copied" : "Copy all codes"}
        </button>
        <button type="button" onClick={() => window.print()} className="btn btn-outline">
          Print
        </button>
      </div>
    </div>
  );
}
