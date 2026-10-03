/**
 * Refill reminders (benchmark gap R2): when a supplement order runs out, and
 * so when to remind. Pure, so the arithmetic is tested (tests/refill.test.ts);
 * scheduling and sending are in src/server/refill-reminders.ts.
 *
 * A pack of 30 gummies at 2 a day lasts 15 days from delivery. An order of
 * several products runs out when its first product does, and the reminder
 * goes a few days before that, so a refill can arrive in time (delivery is
 * 2 to 4 days).
 */

/** Days before run-out that the reminder goes. */
export const REMIND_DAYS_BEFORE = 5;

/** A reminder this late after run-out is no longer useful, so it isn't sent. */
export const STALE_AFTER_DAYS = 10;

export interface RefillLine {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly servingsPerContainer: number | null;
  readonly servingsPerDay: number | null;
}

/** Days one order line lasts, or null when the product can't be counted (not a supplement, or no daily dose set). */
export function daysOfSupply(line: RefillLine): number | null {
  if (!line.servingsPerContainer || !line.servingsPerDay || line.servingsPerDay <= 0 || line.quantity <= 0) return null;
  return Math.floor((line.servingsPerContainer * line.quantity) / line.servingsPerDay);
}

/** The lines a reminder is about: one per product that can be counted. */
export function refillableLines(lines: readonly RefillLine[]): RefillLine[] {
  const byProduct = new Map<string, RefillLine>();
  for (const l of lines) {
    const cur = byProduct.get(l.productId);
    byProduct.set(l.productId, cur ? { ...cur, quantity: cur.quantity + l.quantity } : l);
  }
  return [...byProduct.values()].filter((l) => daysOfSupply(l) !== null);
}

/** When the order runs out, counting from delivery, or null when nothing in it can be counted. */
export function runOutDate(lines: readonly RefillLine[], deliveredAt: Date): Date | null {
  const days = refillableLines(lines).map((l) => daysOfSupply(l)!);
  if (days.length === 0) return null;
  return new Date(deliveredAt.getTime() + Math.min(...days) * 86_400_000);
}

/** When the reminder goes: a few days before run-out, and never before delivery. */
export function reminderDate(lines: readonly RefillLine[], deliveredAt: Date): Date | null {
  const runOut = runOutDate(lines, deliveredAt);
  if (!runOut) return null;
  return new Date(Math.max(deliveredAt.getTime(), runOut.getTime() - REMIND_DAYS_BEFORE * 86_400_000));
}

/** True when run-out was so long ago that a reminder would only be noise. */
export function isStale(lines: readonly RefillLine[], deliveredAt: Date, now: Date): boolean {
  const runOut = runOutDate(lines, deliveredAt);
  return !runOut || now.getTime() > runOut.getTime() + STALE_AFTER_DAYS * 86_400_000;
}
