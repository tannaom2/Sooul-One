/**
 * The customer wallet, worked out from an append-only ledger (WalletEntry).
 * Pure, unit-tested; nothing here writes.
 *
 * Credits carry their own expiry. A redemption records which credits it
 * drew on ({ creditId, paise }), oldest-expiring first, and a refund puts
 * back exactly those, so each credit keeps its own expiry date through a
 * cancelled order. Nothing is ever edited or deleted: the balance is always
 * the ledger replayed.
 */

import type { Paise } from "./money";

export type WalletKind = "REFERRAL_CREDIT" | "ORDER_REDEMPTION" | "REDEMPTION_REFUND" | "ADJUSTMENT";

export interface Allocation {
  readonly creditId: string;
  readonly paise: Paise;
}

export interface LedgerEntry {
  readonly id: string;
  readonly kind: WalletKind;
  /** Signed: credits positive, redemptions negative. */
  readonly amountPaise: Paise;
  readonly expiresAt: Date | null;
  readonly allocations: readonly Allocation[] | null;
  readonly createdAt: Date;
}

export interface WalletCredit {
  readonly id: string;
  readonly remainingPaise: Paise;
  readonly expiresAt: Date | null;
}

export interface WalletState {
  readonly availablePaise: Paise;
  /** Unexpired credits with money left, soonest-expiring first. */
  readonly credits: readonly WalletCredit[];
  /** The next credit to expire, and how much of it is left. */
  readonly nextExpiry: WalletCredit | null;
}

const isCredit = (e: LedgerEntry) => e.kind === "REFERRAL_CREDIT" || (e.kind === "ADJUSTMENT" && e.amountPaise > 0);

export function walletState(entries: readonly LedgerEntry[], now: Date): WalletState {
  const used = new Map<string, number>();
  for (const e of entries) {
    const sign = e.kind === "ORDER_REDEMPTION" ? 1 : e.kind === "REDEMPTION_REFUND" ? -1 : 0;
    if (!sign) continue;
    for (const a of e.allocations ?? []) used.set(a.creditId, (used.get(a.creditId) ?? 0) + sign * a.paise);
  }
  const credits = entries
    .filter(isCredit)
    .filter((e) => !e.expiresAt || e.expiresAt > now)
    .map((e) => ({ id: e.id, remainingPaise: Math.max(0, e.amountPaise - (used.get(e.id) ?? 0)), expiresAt: e.expiresAt }))
    .filter((c) => c.remainingPaise > 0)
    .sort(byExpiry);
  return {
    availablePaise: credits.reduce((n, c) => n + c.remainingPaise, 0),
    credits,
    nextExpiry: credits.find((c) => c.expiresAt) ?? null,
  };
}

function byExpiry(a: WalletCredit, b: WalletCredit): number {
  if (!a.expiresAt) return b.expiresAt ? 1 : 0;
  if (!b.expiresAt) return -1;
  return a.expiresAt.getTime() - b.expiresAt.getTime();
}

/** Which credits pay for `amountPaise`, oldest-expiring first; null if there isn't enough. */
export function allocate(entries: readonly LedgerEntry[], amountPaise: Paise, now: Date): Allocation[] | null {
  if (amountPaise <= 0) return [];
  const { credits, availablePaise } = walletState(entries, now);
  if (availablePaise < amountPaise) return null;
  const out: Allocation[] = [];
  let left = amountPaise;
  for (const c of credits) {
    if (left === 0) break;
    const take = Math.min(left, c.remainingPaise);
    out.push({ creditId: c.id, paise: take });
    left -= take;
  }
  return out;
}

/** Reads the allocations JSON stored on a WalletEntry. */
export function parseAllocations(json: unknown): Allocation[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((a): a is { creditId: string; paise: number } => typeof a?.creditId === "string" && Number.isInteger(a?.paise))
    .map((a) => ({ creditId: a.creditId, paise: a.paise }));
}
