/** Shared number formats for the analytics reports. */

export const pct = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`);

export const days = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)} d`);

export const ist = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export const istDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** A window from the URL: 7, 30, 90 or 365 days. */
export function parseDays(raw: string | undefined, fallback = 90): number {
  const n = Number(raw);
  return [7, 30, 90, 365].includes(n) ? n : fallback;
}

/** Build a report URL, dropping defaults so links stay short. */
export function reportHref(path: string, params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
