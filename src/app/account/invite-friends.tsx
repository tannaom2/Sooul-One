"use client";

import { useState } from "react";
import { formatPriceTag } from "@/lib/money";
import { formatDate } from "@/lib/format";

export interface InviteData {
  readonly link: string;
  readonly code: string;
  readonly rewardsIssued: number;
  readonly maxRewards: number;
  readonly referrerRewardPaise: number;
  readonly refereeRewardPaise: number;
  readonly minOrderPaise: number;
  readonly maxCreditPerOrderPaise: number;
  readonly walletPaise: number;
  readonly nextExpiry: { paise: number; on: string | null } | null;
  readonly friends: readonly { id: string; label: string; stage: string; done: boolean; holdUntil: string | null }[];
}

/**
 * Invite friends: the shopper's link, shared by WhatsApp in one tap (a plain
 * wa.me link: SooulOne never sees or stores a friend's number), their reward
 * progress towards the cap, their credit, and each friend's stage.
 */
export function InviteFriends({ data }: { data: InviteData }) {
  const [copied, setCopied] = useState(false);
  const reward = formatPriceTag(data.referrerRewardPaise);
  const friendOff = formatPriceTag(data.refereeRewardPaise);
  const min = formatPriceTag(data.minOrderPaise);
  const message = `I shop snacks and gummies at SooulOne: every label's on the page before you buy. Here's ${friendOff} off your first order of ${min}+:`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${message} ${data.link}`)}`;
  const left = Math.max(0, data.maxRewards - data.rewardsIssued);

  async function copy() {
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="panel p-4">
        <p className="text-small">
          Friends get <strong>{friendOff} off</strong> their first order of {min} or more. You get <strong>{reward} credit</strong> once
          their order is delivered and past the return window, for up to {data.maxRewards} friends.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="border border-rule bg-shelf px-3 py-2 text-small break-all" style={{ borderRadius: "var(--radius-panel)" }}>
            {data.link}
          </code>
          <button type="button" onClick={copy} className="btn btn-outline px-3 py-2 text-small">
            {copied ? "Copied" : "Copy link"}
          </button>
          <a href={whatsapp} target="_blank" rel="noopener" className="btn btn-solid px-3 py-2 text-small">
            Share on WhatsApp
          </a>
        </div>
        <p className="mt-2 text-micro text-ink-faint">Or tell them your code: <strong className="tracking-wider">{data.code}</strong></p>

        <div className="mt-4">
          <p className="text-small font-semibold">
            <span className="tabular">{data.rewardsIssued}</span> of {data.maxRewards} rewards earned
          </p>
          <div className="mt-1.5 flex gap-1.5" aria-hidden>
            {Array.from({ length: data.maxRewards }, (_, i) => (
              <span key={i} className={`h-2.5 flex-1 ${i < data.rewardsIssued ? "bg-veg" : "bg-shelf"}`} style={{ borderRadius: 999 }} />
            ))}
          </div>
          {left === 0 && <p className="mt-1 text-micro text-ink-faint">You&rsquo;ve earned every reward this programme allows. Thank you for spreading the word.</p>}
        </div>
      </div>

      <dl className="panel">
        <div className="panel-row">
          <dt>Your credit</dt>
          <dd className="tabular font-semibold">{formatPriceTag(data.walletPaise)}</dd>
        </div>
        {data.walletPaise > 0 && (
          <div className="panel-row text-small text-ink-soft">
            <dt>How it&rsquo;s used</dt>
            <dd className="text-right">
              Up to {formatPriceTag(data.maxCreditPerOrderPaise)} off each order of {min} or more, not with discount codes
            </dd>
          </div>
        )}
        {data.nextExpiry?.on && (
          <div className="panel-row text-small text-ink-soft">
            <dt>Next to expire</dt>
            <dd className="tabular">
              {formatPriceTag(data.nextExpiry.paise)} on {formatDate(new Date(data.nextExpiry.on))}
            </dd>
          </div>
        )}
      </dl>

      {data.friends.length > 0 && (
        <ul className="panel divide-y divide-rule">
          {data.friends.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 p-3.5 text-small">
              <span>{f.label}</span>
              <span className={f.done ? "font-semibold text-veg" : "text-ink-soft"}>
                {f.stage}
                {f.holdUntil && ` (${formatDate(new Date(f.holdUntil))})`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
