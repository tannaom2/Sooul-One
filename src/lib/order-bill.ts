/**
 * Turns a stored order into the structured bill the confirmation email renders.
 *
 * Pure and driven only by what was persisted at checkout — never re-priced from
 * the live catalogue — so the bill always matches what the customer was charged
 * even if prices or offers have changed since.
 */

import { decimalToPaise } from "./format";
import type { Paise } from "./money";
import { asAddress, type StoredOrder } from "./stored-order";

export interface BillLine {
  readonly name: string;
  readonly quantity: number;
  /** Undiscounted unit price. */
  readonly listUnitPaise: Paise;
  /** Unit price actually charged (product discount applied). */
  readonly unitPaise: Paise;
  /** Whole-number-friendly percentage saved on this line, or null. */
  readonly percentOff: number | null;
  readonly lineTotalPaise: Paise;
}

export interface OrderBill {
  readonly orderNumber: string;
  readonly placedAt: Date;
  readonly cod: boolean;
  readonly lines: readonly BillLine[];
  /** Lines at undiscounted price. */
  readonly mrpSubtotalPaise: Paise;
  readonly productDiscountPaise: Paise;
  readonly bundle: { readonly label: string; readonly amountPaise: Paise } | null;
  readonly coupon: { readonly code: string; readonly amountPaise: Paise } | null;
  readonly shippingPaise: Paise;
  /** GST already included in the total. */
  readonly taxPaise: Paise;
  readonly totalPaise: Paise;
  readonly totalSavingsPaise: Paise;
  readonly address: {
    readonly name: string;
    readonly lines: readonly string[];
  };
}

export function buildOrderBill(order: StoredOrder): OrderBill {
  // One order row per batch drawn; the customer should see one line per product.
  const grouped = new Map<string, { name: string; quantity: number; unit: Paise; list: Paise; total: Paise }>();

  for (const item of order.items) {
    const unit = decimalToPaise(item.unitPriceSnapshot);
    // Orders placed before discounts existed have no list snapshot: no saving to show.
    const list = item.listUnitPriceSnapshot != null ? decimalToPaise(item.listUnitPriceSnapshot) : unit;
    const key = `${item.productId}|${item.variantId ?? ""}|${unit}|${list}`;
    const existing = grouped.get(key);
    const total = decimalToPaise(item.lineTotal);
    if (existing) {
      existing.quantity += item.quantity;
      existing.total += total;
    } else {
      grouped.set(key, { name: item.productNameSnapshot, quantity: item.quantity, unit, list, total });
    }
  }

  const lines: BillLine[] = [...grouped.values()].map((g) => ({
    name: g.name,
    quantity: g.quantity,
    listUnitPaise: g.list,
    unitPaise: g.unit,
    percentOff: g.list > g.unit ? Math.round(((g.list - g.unit) / g.list) * 1000) / 10 : null,
    lineTotalPaise: g.total,
  }));

  const productDiscountPaise = decimalToPaise(order.productDiscountAmount);
  const bundleAmount = decimalToPaise(order.bundleDiscountAmount);
  const couponAmount = decimalToPaise(order.discountAmount);
  const subtotalPaise = decimalToPaise(order.subtotal);

  const a = asAddress(order.shippingAddress);
  const cityLine = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  return {
    orderNumber: order.orderNumber,
    placedAt: new Date(order.placedAt),
    cod: order.paymentGateway === "COD",
    lines,
    mrpSubtotalPaise: subtotalPaise + productDiscountPaise,
    productDiscountPaise,
    bundle:
      bundleAmount > 0
        ? { label: order.bundleLabel || "Combo savings", amountPaise: bundleAmount }
        : null,
    coupon:
      couponAmount > 0 ? { code: order.couponCode || "Discount code", amountPaise: couponAmount } : null,
    shippingPaise: decimalToPaise(order.shippingAmount),
    taxPaise: decimalToPaise(order.taxAmount),
    totalPaise: decimalToPaise(order.totalAmount),
    totalSavingsPaise: productDiscountPaise + bundleAmount + couponAmount,
    address: {
      name: a.name ?? "",
      lines: [a.line1, a.line2, cityLine].filter((x): x is string => Boolean(x)),
    },
  };
}
