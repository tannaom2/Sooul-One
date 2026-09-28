import "server-only";
import { db } from "@/lib/db";
import { decimalToPaise } from "@/lib/format";
import { asAddress } from "@/lib/stored-order";
import type { CheckoutForm } from "@/lib/checkout/steps";

/** What a signed-in shopper sees: their own orders and details, nobody else's. */

export interface AccountOrder {
  readonly orderNumber: string;
  readonly accessToken: string | null;
  readonly status: string;
  readonly placedAt: Date;
  readonly totalPaise: number;
  readonly itemCount: number;
  readonly firstItem: string | null;
  readonly method: string | null;
}

export async function accountOrders(customerId: string, take = 50): Promise<AccountOrder[]> {
  const orders = await db.order.findMany({
    where: { customerId },
    orderBy: { placedAt: "desc" },
    take,
    select: {
      orderNumber: true,
      accessToken: true,
      status: true,
      placedAt: true,
      totalAmount: true,
      paymentGateway: true,
      items: { select: { productNameSnapshot: true, quantity: true } },
    },
  });
  return orders.map((o) => ({
    orderNumber: o.orderNumber,
    accessToken: o.accessToken,
    status: o.status,
    placedAt: o.placedAt,
    totalPaise: decimalToPaise(o.totalAmount),
    itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
    firstItem: o.items[0]?.productNameSnapshot ?? null,
    method: o.paymentGateway,
  }));
}

/**
 * Checkout details from the shopper's latest order, so a returning shopper
 * only has to choose how to pay. The phone is always the proven one.
 */
export async function checkoutPrefill(customer: { id: string; phone: string | null }): Promise<Partial<CheckoutForm>> {
  const latest = await db.order.findFirst({
    where: { customerId: customer.id },
    orderBy: { placedAt: "desc" },
    select: { guestEmail: true, shippingAddress: true },
  });
  const address = asAddress(latest?.shippingAddress);
  const prefill: Partial<CheckoutForm> = {
    phone: customer.phone ?? "",
    email: latest?.guestEmail ?? "",
    name: address.name ?? "",
    line1: address.line1 ?? "",
    line2: address.line2 ?? "",
    city: address.city ?? "",
    state: address.state ?? "",
    postalCode: address.postalCode ?? "",
  };
  return Object.fromEntries(Object.entries(prefill).filter(([, v]) => v)) as Partial<CheckoutForm>;
}
