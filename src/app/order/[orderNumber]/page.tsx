import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatPriceTag } from "@/lib/money";
import { decimalToPaise, formatDate } from "@/lib/format";
import { orderTokenMatches } from "@/lib/order-access";
import { BasketSync } from "@/components/basket/basket-sync";
import { OrderTracker } from "@/components/order-tracker";
import { orderProgress } from "@/lib/order-progress";
import { asAddress } from "@/lib/stored-order";
import { getCustomer } from "@/server/customer-auth";

export const dynamic = "force-dynamic";


const STATUS_COPY: Record<string, string> = {
  PENDING_PAYMENT: "Waiting for payment to confirm. This usually takes a moment.",
  PAID: "Payment received. We're packing your order.",
  PROCESSING: "We're packing your order.",
  SHIPPED: "On its way.",
  DELIVERED: "Delivered.",
  CANCELLED: "Cancelled.",
  REFUNDED: "Refunded.",
  FAILED: "Payment didn't go through. Nothing has been charged.",
  RTO: "This parcel couldn't be delivered and is on its way back to us.",
  RETURNED: "Returned to us.",
};

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { orderNumber } = await params;
  const { t } = await searchParams;

  // A database error propagates to the nearest error.tsx rather than showing
  // "order not found" — a shopper landing here right after paying should
  // never be told their order doesn't exist because of a transient outage
  // that a retry would clear.
  const order = await db.order.findUnique({
    where: { orderNumber },
    include: {
      items: true,
      // Only what the tracker reads; staff notes stay in admin (order-progress.ts).
      events: { select: { type: true, detail: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
  });
  // A wrong or missing token gets the same 404 as a nonexistent order, so the
  // page can't be used to confirm which order numbers exist. A signed-in
  // shopper needs no token for their own orders (the account page links here).
  if (!order) notFound();
  if (!orderTokenMatches(t, order.accessToken)) {
    const customer = order.customerId ? await getCustomer() : null;
    if (!customer || customer.id !== order.customerId) notFound();
  }

  const address = asAddress(order.shippingAddress);

  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <BasketSync />
      <p className="text-small font-semibold text-veg">Order placed</p>
      <h1 className="mt-2 text-h1 font-extrabold">Thank you</h1>
      <p className="mt-3 text-lead text-ink-soft">{STATUS_COPY[order.status] ?? order.status}</p>

      <OrderTracker progress={orderProgress(order, order.events)} />
      {order.invoiceNumber && (
        <p className="mt-4 text-small">
          <Link href={`/order/${order.orderNumber}/invoice?t=${encodeURIComponent(order.accessToken ?? "")}`} className="underline">
            Tax invoice {order.invoiceNumber}
          </Link>
        </p>
      )}

      <div className="panel mt-8">
        <div className="panel-head flex items-center justify-between">
          <span className="tabular">{order.orderNumber}</span>
          <span className="text-micro font-normal text-ink-faint">
            {formatDate(order.placedAt)}
          </span>
        </div>

        <dl>
          {order.items.map((item) => (
            <div className="panel-row" key={item.id}>
              <dt>
                {item.productNameSnapshot}
                <span className="ml-2 text-ink-faint">× {item.quantity}</span>
              </dt>
              <dd>{formatPriceTag(decimalToPaise(item.lineTotal))}</dd>
            </div>
          ))}
          {/* Offers, so the lines above add up to the total: items are listed at the
              price paid before combo and code savings, as checkout showed them. */}
          {decimalToPaise(order.bundleDiscountAmount) > 0 && (
            <div className="panel-row">
              <dt>Combo savings{order.bundleLabel ? ` (${order.bundleLabel})` : ""}</dt>
              <dd className="text-veg">−{formatPriceTag(decimalToPaise(order.bundleDiscountAmount))}</dd>
            </div>
          )}
          {decimalToPaise(order.discountAmount) > 0 && (
            <div className="panel-row">
              <dt>Discount code{order.couponCode ? ` (${order.couponCode})` : ""}</dt>
              <dd className="text-veg">−{formatPriceTag(decimalToPaise(order.discountAmount))}</dd>
            </div>
          )}
          {decimalToPaise(order.creditAmount) > 0 && (
            <div className="panel-row">
              <dt>{order.creditKind === "WELCOME" ? "Welcome offer" : "Referral credit"}</dt>
              <dd className="text-veg">−{formatPriceTag(decimalToPaise(order.creditAmount))}</dd>
            </div>
          )}
          <div className="panel-row">
            <dt>Delivery</dt>
            <dd>
              {decimalToPaise(order.shippingAmount) === 0
                ? "Free"
                : formatPriceTag(decimalToPaise(order.shippingAmount))}
            </dd>
          </div>
          <div className="panel-row text-ink-faint">
            <dt>of which GST</dt>
            <dd>{formatPriceTag(decimalToPaise(order.taxAmount))}</dd>
          </div>
          <div className="panel-row font-display text-lead font-bold">
            <dt>Total</dt>
            <dd>{formatPriceTag(decimalToPaise(order.totalAmount))}</dd>
          </div>
        </dl>

        <div className="border-t border-rule p-3.5 text-small text-ink-soft">
          <p className="font-semibold text-ink">Delivering to</p>
          <p className="mt-1">
            {address?.name}, {address?.line1}
            {address?.line2 ? `, ${address.line2}` : ""}, {address?.city}, {address?.state}{" "}
            <span className="tabular">{address?.postalCode}</span>
          </p>
        </div>
      </div>

      <Link href="/" className="btn btn-outline mt-8">
        Keep shopping
      </Link>
    </div>
  );
}
