/**
 * The packing screen's sums (Orders › Packing): one pick list for several
 * orders, by product and the batch each unit was set aside from at checkout
 * (oldest still-sendable batch first), and what each packing slip says.
 * Pure, tested (tests/console-nav.test.ts).
 */

export interface PackLine {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  /** The batch the units were allocated from when the order was placed; null on old orders. */
  readonly batchNumber: string | null;
}

export interface PackOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly lines: readonly PackLine[];
}

export interface PickRow {
  readonly name: string;
  readonly batchNumber: string | null;
  readonly units: number;
  readonly orders: number;
}

/** Units to fetch per product and batch across the chosen orders, biggest first, then by name. */
export function pickList(orders: readonly PackOrder[]): PickRow[] {
  const rows = new Map<string, { name: string; batchNumber: string | null; units: number; orders: Set<string> }>();
  for (const o of orders) {
    for (const l of o.lines) {
      const key = `${l.productId}|${l.batchNumber ?? ""}`;
      const r = rows.get(key) ?? { name: l.name, batchNumber: l.batchNumber, units: 0, orders: new Set<string>() };
      r.units += l.quantity;
      r.orders.add(o.id);
      rows.set(key, r);
    }
  }
  return [...rows.values()]
    .map((r) => ({ name: r.name, batchNumber: r.batchNumber, units: r.units, orders: r.orders.size }))
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name) || (a.batchNumber ?? "").localeCompare(b.batchNumber ?? ""));
}

/** One slip line per product and batch in an order (a line split across two batches shows both). */
export function slipLines(lines: readonly PackLine[]): PackLine[] {
  const merged = new Map<string, PackLine>();
  for (const l of lines) {
    const key = `${l.productId}|${l.batchNumber ?? ""}`;
    const cur = merged.get(key);
    merged.set(key, cur ? { ...cur, quantity: cur.quantity + l.quantity } : l);
  }
  return [...merged.values()];
}

/** Whole days an order has waited since it was placed. */
export const daysWaiting = (placedAt: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - placedAt.getTime()) / 86_400_000));
