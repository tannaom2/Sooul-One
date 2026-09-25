/**
 * The shape of a placed order as the bill, the tax invoice and the emails read
 * it (audit L2: these took `any`). Structural rather than Prisma's row type,
 * because checkout hands over freshly built rows whose amounts are strings,
 * while pages pass database rows whose amounts are Decimals. Both satisfy it,
 * and decimalToPaise reads either.
 */

/** A money amount as stored: Prisma Decimal, a "123.45" string, or a number. */
export type StoredAmount = { toString(): string } | number;

export interface StoredAddress {
  readonly name?: string;
  readonly line1?: string;
  readonly line2?: string | null;
  readonly city?: string;
  readonly state?: string;
  readonly postalCode?: string;
  readonly phone?: string;
}

export interface StoredOrderItem {
  readonly productId: string;
  readonly variantId?: string | null;
  readonly productNameSnapshot: string;
  readonly quantity: number;
  readonly unitPriceSnapshot: StoredAmount;
  readonly listUnitPriceSnapshot?: StoredAmount | null;
  readonly lineTotal: StoredAmount;
  readonly hsnCode?: string | null;
  readonly taxRatePercent?: StoredAmount | null;
  readonly taxableAmount?: StoredAmount | null;
  readonly taxAmount?: StoredAmount | null;
  /** Older orders predate per-row tax facts; the invoice falls back to the product's. */
  readonly product?: { readonly hsnCode?: string | null; readonly taxRatePercent?: StoredAmount | null } | null;
}

export interface StoredOrder {
  readonly orderNumber: string;
  /** Null on orders placed before order links had tokens. */
  readonly accessToken: string | null;
  readonly placedAt: Date | string;
  readonly paymentGateway?: string | null;
  readonly guestEmail?: string | null;
  readonly customer?: { readonly email: string } | null;
  readonly subtotal: StoredAmount;
  readonly productDiscountAmount: StoredAmount;
  readonly bundleDiscountAmount: StoredAmount;
  readonly bundleLabel?: string | null;
  readonly discountAmount: StoredAmount;
  readonly couponCode?: string | null;
  readonly shippingAmount: StoredAmount;
  readonly shippingTaxAmount?: StoredAmount | null;
  readonly taxAmount: StoredAmount;
  readonly totalAmount: StoredAmount;
  readonly gstTreatment?: string | null;
  /** JSON columns: read through asAddress. */
  readonly shippingAddress: unknown;
  readonly billingAddress?: unknown;
  readonly trackingNumber?: string | null;
  readonly courierPartner?: string | null;
  readonly invoiceNumber?: string | null;
  readonly invoiceDate?: Date | string | null;
  readonly items: readonly StoredOrderItem[];
}

/** What the shipping email needs: no amounts or item rows. */
export type ShippingNoticeOrder = Pick<
  StoredOrder,
  "orderNumber" | "accessToken" | "guestEmail" | "customer" | "trackingNumber" | "courierPartner"
>;

/** An address from a JSON column, keeping only text fields. Never throws. */
export function asAddress(json: unknown): StoredAddress {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const source = json as Record<string, unknown>;
  const text = (key: string) => (typeof source[key] === "string" ? (source[key] as string) : undefined);
  return {
    name: text("name"),
    line1: text("line1"),
    line2: text("line2") ?? null,
    city: text("city"),
    state: text("state"),
    postalCode: text("postalCode"),
    phone: text("phone"),
  };
}
