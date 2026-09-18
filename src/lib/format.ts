/**
 * Display helpers. Presentation only — never used for arithmetic, which stays
 * in integer paise inside src/lib/money.ts.
 */
import { formatINR } from "./money";

export { formatINR };

/** Prisma Decimal arrives as an object; normalise it to paise. */
export function decimalToPaise(value: { toString(): string } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const asString = typeof value === "number" ? value.toFixed(2) : value.toString();
  const [whole, fraction = ""] = asString.split(".");
  const sign = asString.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2)));
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Best-before is a legally displayed date and must not be localised into an
 * ambiguous order. Written long so 03/04 can never be read as March or April.
 */
export function formatBestBefore(date: Date | string): string {
  return formatDate(date);
}

export function orderNumber(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const noise = Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, "0");
  return `SO-${stamp}-${noise}`;
}
