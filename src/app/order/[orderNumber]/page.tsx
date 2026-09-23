import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/money";
import { decimalToPaise, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_COPY: Record<string, string> = {
  PENDING_PAYMENT: "Waiting for payment to confirm. This usually takes a moment.",
  PAID: "Payment received. We're packing your order.",
  PROCESSING: "We're packing your order.",
  SHIPPED: "On its way.",
  DELIVERED: "Delivered.",
  CANCELLED: "Cancelled.",
  REFUNDED: "Refunded.",
  FAILED: "Payment didn't go through. Nothing has been charged.",
};

export default async function OrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;

  // A database error propagates to the nearest error.tsx rather than showing
  // "order not found" — a shopper landing here right after paying should
  // never be told their order doesn't exist because of a transient outage
  // that a retry would clear.
  const order: any = await db.order.findUnique({
    where: { orderNumber },
    include: { items: true },
  });
  if (!order) notFound();

  const address = order.shippingAddress as any;

  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <p className="text-small font-semibold text-veg">Order placed</p>
      <h1 className="mt-2 text-h1 font-extrabold">Thank you</h1>
      <p className="mt-3 text-lead text-ink-soft">{STATUS_COPY[order.status] ?? order.status}</p>

      <div className="panel mt-8">
        <div className="panel-head flex items-center justify-between">
          <span className="tabular">{order.orderNumber}</span>
          <span className="text-micro font-normal text-ink-faint">
            {formatDate(order.placedAt)}
          </span>
        </div>

        <dl>
          {order.items.map((item: any) => (
            <div className="panel-row" key={item.id}>
              <dt>
                {item.productNameSnapshot}
                <span className="ml-2 text-ink-faint">× {item.quantity}</span>
              </dt>
              <dd>{formatINR(decimalToPaise(item.lineTotal))}</dd>
            </div>
          ))}
          <div className="panel-row">
            <dt>Delivery</dt>
            <dd>
              {decimalToPaise(order.shippingAmount) === 0
                ? "Free"
                : formatINR(decimalToPaise(order.shippingAmount))}
            </dd>
          </div>
          <div className="panel-row text-ink-faint">
            <dt>of which GST</dt>
            <dd>{formatINR(decimalToPaise(order.taxAmount))}</dd>
          </div>
          <div className="panel-row font-display text-lead font-bold">
            <dt>Total</dt>
            <dd>{formatINR(decimalToPaise(order.totalAmount))}</dd>
          </div>
        </dl>

        <div className="border-t border-[--color-rule] p-3.5 text-small text-ink-soft">
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
