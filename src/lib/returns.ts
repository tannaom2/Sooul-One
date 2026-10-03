import { requiredRemainingDays, wholeDaysBetween } from "@/lib/compliance/shelf-life";

/**
 * Checking a parcel that came back (RTO, or returned by the customer). Only a
 * cancellation puts stock back by itself (releasesStock in
 * src/lib/order-lifecycle.ts): a returned parcel may be opened or damaged,
 * and food must be looked at before it's sold again. So each line is checked
 * and decided here. Pure, so the rules are tested (tests/returns.test.ts).
 */

export type ReturnOutcome = "RESTOCKED" | "QUARANTINED" | "WRITTEN_OFF";

export const OUTCOME_LABEL: Record<ReturnOutcome, { title: string; hint: string }> = {
  RESTOCKED: { title: "Back to stock", hint: "Sealed and undamaged: back on sale from its batch." },
  QUARANTINED: { title: "Set aside", hint: "Keep it apart and decide later." },
  WRITTEN_OFF: { title: "Write off", hint: "Opened, damaged or unsellable: not sold again." },
};

/** Statuses whose parcel has come back and needs checking. */
export const RETURNED_STATUSES = ["RTO", "RETURNED"] as const;

export const isReturned = (status: string) => (RETURNED_STATUSES as readonly string[]).includes(status);

/** A decision is final once restocked or written off; a set-aside line can still be decided. */
export const isFinal = (outcome: ReturnOutcome | null | undefined) => outcome === "RESTOCKED" || outcome === "WRITTEN_OFF";

/**
 * Whether these units may go back on sale: never from a recalled batch, and
 * not when too little shelf life is left to ship them under the FSSAI
 * e-commerce rule, judged at today's slowest delivery.
 */
export function restockProblem(
  batch: { recalledAt: Date | null; expiresOn: Date } | null,
  shelfLifeDays: number | null,
  arrivesBy: Date,
): string | null {
  if (!batch) return "No batch is recorded for this line, so it can't go back into stock. Write it off or set it aside.";
  if (batch.recalledAt) return "This batch is recalled: write it off or set it aside with the recalled stock.";
  if (shelfLifeDays && wholeDaysBetween(arrivesBy, batch.expiresOn) < requiredRemainingDays(shelfLifeDays)) {
    return "Too close to its best-before to ship again: write it off or set it aside.";
  }
  return null;
}

/** "2 back to stock, 1 written off", for the order's timeline. */
export function decisionSummary(decisions: readonly { outcome: ReturnOutcome; quantity: number }[]): string {
  const total = (o: ReturnOutcome) => decisions.filter((d) => d.outcome === o).reduce((n, d) => n + d.quantity, 0);
  return [
    total("RESTOCKED") && `${total("RESTOCKED")} back to stock`,
    total("QUARANTINED") && `${total("QUARANTINED")} set aside`,
    total("WRITTEN_OFF") && `${total("WRITTEN_OFF")} written off`,
  ]
    .filter(Boolean)
    .join(", ");
}
