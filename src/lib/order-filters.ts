/**
 * Parses the /admin/orders query string. Every value is checked against a
 * fixed list or range — anything unrecognised falls back to the default, so
 * a hand-edited URL can narrow the list but never reach the query raw.
 */

export const ORDER_VIEWS = {
  all: { label: "All", statuses: null },
  to_ship: { label: "To ship", statuses: ["PAID", "PROCESSING"] },
  shipped: { label: "Shipped", statuses: ["SHIPPED"] },
  delivered: { label: "Delivered", statuses: ["DELIVERED"] },
  awaiting_payment: { label: "Awaiting payment", statuses: ["PENDING_PAYMENT"] },
  returned: { label: "Returned & RTO", statuses: ["RTO", "RETURNED"] },
  closed: { label: "Cancelled & refunded", statuses: ["CANCELLED", "REFUNDED", "FAILED"] },
} as const satisfies Record<string, { label: string; statuses: readonly string[] | null }>;

export type OrderView = keyof typeof ORDER_VIEWS;

export type OrderFilters = { view: OrderView; q: string; page: number };

export const ORDERS_PAGE_SIZE = 25;

export function parseOrderFilters(params: { view?: string; q?: string; page?: string }): OrderFilters {
  const view = params.view && Object.hasOwn(ORDER_VIEWS, params.view) ? (params.view as OrderView) : "all";
  // Trimmed and capped: this is only ever used as a `contains` match.
  const q = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(params.page)) || 1));
  return { view, q, page };
}

/** Builds a canonical URL, dropping defaults so links stay short. */
export function orderFiltersHref(f: Partial<OrderFilters>): string {
  const q = new URLSearchParams();
  if (f.view && f.view !== "all") q.set("view", f.view);
  if (f.q) q.set("q", f.q);
  if (f.page && f.page > 1) q.set("page", String(f.page));
  const s = q.toString();
  return `/admin/orders${s ? `?${s}` : ""}`;
}

/** Percentage change, or null when there is no previous period to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
