/**
 * The 10-item rule for dense admin lists: ten rows per page, with the rest of
 * the page given to charts of exactly those ten rows. Pure, so it's tested.
 */

export const INTEL_PAGE_SIZE = 10;

/** A page number from the URL, clamped to what exists. */
export function parsePage(raw: string | undefined, total: number, size = INTEL_PAGE_SIZE): number {
  const pages = pageCount(total, size);
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, pages) : 1;
}

export function pageCount(total: number, size = INTEL_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** One page of an already-sorted list. */
export function pageOf<T>(rows: readonly T[], page: number, size = INTEL_PAGE_SIZE): T[] {
  return rows.slice((page - 1) * size, page * size);
}
