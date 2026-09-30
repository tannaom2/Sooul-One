/**
 * The public batch check (/verify). A shopper types the batch number printed
 * on their pack; we say whether it's one of ours, which product it is, when
 * it was made and its best-before date. Pure, so the rules are tested
 * (tests/batch-verify.test.ts); the lookup is in src/server/batch-verify.ts.
 *
 * What it can and can't prove, and so what it says: a batch number is printed
 * on thousands of packs and can be copied, so a match proves the BATCH is
 * genuine, not the pack in someone's hand. The result says exactly that
 * ("this batch is ours"), in line with how brands that verify at batch level
 * word it; only a unique code per pack could prove more. A miss is never
 * called a fake: codes get misread, and the answer is to check and ask us.
 */

/** Batch numbers as printed vary in case, spaces and punctuation ("b-2410 07" = "B241007"). */
export function normalizeBatch(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A plausible batch number: 3 to 30 letters and digits once cleaned up. */
export function validBatch(normalized: string): boolean {
  return /^[A-Z0-9]{3,30}$/.test(normalized);
}

export interface BatchFacts {
  readonly productName: string;
  readonly productSlug: string;
  readonly brandName: string;
  readonly batchNumber: string;
  readonly manufacturedOn: Date;
  readonly expiresOn: Date;
  readonly recalledAt: Date | null;
  readonly recallNote: string | null;
}

export type BatchStatus = "good" | "expired" | "recalled";

/** Recalled outranks everything; past its best-before date next. */
export function batchStatus(batch: Pick<BatchFacts, "expiresOn" | "recalledAt">, now: Date): BatchStatus {
  if (batch.recalledAt && batch.recalledAt.getTime() <= now.getTime()) return "recalled";
  return batch.expiresOn.getTime() < now.getTime() ? "expired" : "good";
}

export type VerifyResult =
  | { readonly kind: "invalid" }
  | { readonly kind: "not-found"; readonly batch: string }
  | { readonly kind: "found"; readonly batch: string; readonly matches: readonly (BatchFacts & { readonly status: BatchStatus })[] };

/** The answer for a typed code and the batches that matched it. */
export function verifyResult(input: string, matches: readonly BatchFacts[], now: Date): VerifyResult {
  const batch = normalizeBatch(input);
  if (!validBatch(batch)) return { kind: "invalid" };
  if (matches.length === 0) return { kind: "not-found", batch };
  return { kind: "found", batch, matches: matches.map((m) => ({ ...m, status: batchStatus(m, now) })) };
}
