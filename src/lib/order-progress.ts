/**
 * What the customer's order page shows about progress: Placed → Packing →
 * Shipped → Delivered, with the date each happened, built from the same
 * OrderEvent history staff see. Customer-safe by construction: it reads only
 * status changes, payment capture and tracking, never staff NOTE events or
 * email records. Pure, so it's tested directly.
 */

export type StageKey = "placed" | "packing" | "shipped" | "delivered";

export interface Stage {
  readonly key: StageKey;
  readonly label: string;
  readonly done: boolean;
  readonly current: boolean;
  readonly date: Date | null;
}

export interface OrderProgress {
  readonly stages: readonly Stage[];
  /** Cancelled, refunded or failed: shown instead of the next stage. */
  readonly ended: { readonly label: string; readonly date: Date | null } | null;
  readonly tracking: { readonly number: string; readonly courier: string | null } | null;
}

interface EventLike {
  type: string;
  createdAt: Date | string;
  detail?: unknown;
}

const ORDER: StageKey[] = ["placed", "packing", "shipped", "delivered"];
const LABELS: Record<StageKey, string> = { placed: "Placed", packing: "Packing", shipped: "Shipped", delivered: "Delivered" };
const REACHED: Record<string, number> = { PENDING_PAYMENT: 0, PAID: 1, PROCESSING: 1, SHIPPED: 2, DELIVERED: 3 };
const ENDED: Record<string, string> = {
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  FAILED: "Payment didn't go through; nothing was charged",
};

function statusTo(event: EventLike): string | null {
  const d = event.detail as { status?: { to?: unknown } } | null | undefined;
  return typeof d?.status?.to === "string" ? d.status.to : null;
}

export function orderProgress(
  order: { status: string; placedAt: Date | string; trackingNumber?: string | null; courierPartner?: string | null },
  events: readonly EventLike[],
): OrderProgress {
  const when = (e: EventLike | undefined) => (e ? new Date(e.createdAt) : null);
  const firstTo = (status: string) => when(events.find((e) => e.type === "STATUS_CHANGED" && statusTo(e) === status));

  const dates: Record<StageKey, Date | null> = {
    placed: new Date(order.placedAt),
    // Packing starts when paid online, or at once for COD (created as PROCESSING).
    packing: when(events.find((e) => e.type === "PAYMENT_CAPTURED")) ?? firstTo("PROCESSING") ?? firstTo("PAID"),
    shipped: firstTo("SHIPPED"),
    delivered: firstTo("DELIVERED"),
  };

  const endedLabel = ENDED[order.status];
  // For an ended order, show how far it got before it stopped.
  const reached = endedLabel
    ? Math.max(0, ...ORDER.map((k, i) => (i > 0 && dates[k] ? i : 0)))
    : (REACHED[order.status] ?? 0);

  // COD orders skip PENDING_PAYMENT: packing began when they were placed.
  if (reached >= 1 && !dates.packing) dates.packing = dates.placed;

  const stages = ORDER.map((key, i) => ({
    key,
    label: LABELS[key],
    done: i <= reached,
    current: !endedLabel && i === reached,
    date: i <= reached ? dates[key] : null,
  }));

  const endEvent = [...events].reverse().find((e) => e.type === "REFUNDED" || (e.type === "STATUS_CHANGED" && statusTo(e) === order.status));
  return {
    stages,
    ended: endedLabel ? { label: endedLabel, date: when(endEvent) } : null,
    tracking:
      order.trackingNumber && reached >= 2 ? { number: order.trackingNumber, courier: order.courierPartner ?? null } : null,
  };
}
