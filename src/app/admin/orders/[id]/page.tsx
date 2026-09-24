import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { NoAccess } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { decimalToPaise } from "@/lib/format";
import { OrderStatusForm } from "../status-form";
import { OrderNoteForm } from "./note-form";
import { CLOSE_REASONS, STATUS_LABELS, allowedMoves } from "@/lib/order-lifecycle";

const reasonLabel = (code: string) =>
  Object.values(CLOSE_REASONS).flat().find((r) => r.code === code)?.label ?? code;

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

const EMAIL_LABEL: Record<string, string> = {
  order_confirmation: "Order confirmation email",
  shipping_notification: "Shipping email",
};

/** One line of plain English per event, with any extra detail beneath. */
function describe(e: { type: string; detail: any }): { title: string; body?: string; warn?: boolean } {
  const d = e.detail ?? {};
  switch (e.type) {
    case "PLACED":
      return { title: "Order placed", body: d.method ? `Payment: ${d.method === "COD" ? "cash on delivery" : "card / UPI"}` : undefined };
    case "PAYMENT_CAPTURED":
      return { title: "Payment received", body: d.amountPaise ? formatINR(Number(d.amountPaise)) : undefined };
    case "PAYMENT_FAILED":
      return { title: "Payment failed", body: d.reason ?? undefined, warn: true };
    case "REFUNDED":
      return { title: "Refunded", body: d.amountPaise ? formatINR(Number(d.amountPaise)) : undefined };
    case "STATUS_CHANGED": {
      const parts: string[] = [];
      if (d.status) parts.push(`${String(d.status.from ?? "—").toLowerCase().replace(/_/g, " ")} → ${String(d.status.to).toLowerCase().replace(/_/g, " ")}`);
      if (d.closeReason?.to) parts.push(`Reason: ${reasonLabel(String(d.closeReason.to))}`);
      if (d.courierPartner?.to) parts.push(`Courier: ${d.courierPartner.to}`);
      if (d.trackingNumber) parts.push(`Tracking: ${d.trackingNumber.to ?? "—"}`);
      return { title: "Status changed", body: parts.join(" · ") || undefined };
    }
    case "EMAIL_SENT":
      return {
        title: `${EMAIL_LABEL[d.email] ?? "Email"} ${d.delivered ? "sent" : "not sent"}`,
        body: d.delivered ? undefined : d.reason === "not_configured" ? "Email isn't configured on this server." : d.reason ?? undefined,
        warn: !d.delivered,
      };
    case "NOTE":
      return { title: "Note", body: d.note };
    default:
      return { title: e.type };
  }
}

function actorLabel(e: { actorType: string; actorEmail: string | null }): string {
  if (e.actorType === "ADMIN") return e.actorEmail ?? "staff";
  if (e.actorType === "CUSTOMER") return "customer";
  return "system";
}

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("orders:view");
  if (!session) return <NoAccess />;
  const canWrite = can(session.role, "orders:write");

  const { id } = await params;
  const order: any = await db.order.findUnique({
    where: { id },
    include: {
      items: { include: { batch: { select: { batchNumber: true } } } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();

  const paidOnline = order.paymentGateway === "RAZORPAY" && order.paymentStatus === "captured";
  const address = order.shippingAddress ?? {};
  const money = (v: unknown) => formatINR(decimalToPaise(v as any));

  return (
    <div className="grid gap-8">
      <div>
        <Link href="/admin/orders" className="text-small text-ink-soft hover:underline">
          ← All orders
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="tabular text-h2 font-extrabold">{order.orderNumber}</h1>
          <p className="text-small text-ink-soft">
            {STATUS_LABELS[order.status as keyof typeof STATUS_LABELS] ?? order.status} · placed {when.format(order.placedAt)}
            {order.closeReason && <> · {reasonLabel(order.closeReason)}</>}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="grid content-start gap-6">
          <section className="panel">
            <div className="panel-head">Items</div>
            <dl>
              {order.items.map((item: any) => (
                <div key={item.id} className="panel-row">
                  <dt>
                    {item.productNameSnapshot} <span className="text-ink-faint">× {item.quantity}</span>
                    {item.batch && <span className="ml-2 text-micro text-ink-faint">batch {item.batch.batchNumber}</span>}
                  </dt>
                  <dd>{money(item.lineTotal)}</dd>
                </div>
              ))}
              {decimalToPaise(order.productDiscountAmount) > 0 && (
                <div className="panel-row"><dt>Product savings</dt><dd className="text-veg">−{money(order.productDiscountAmount)}</dd></div>
              )}
              {decimalToPaise(order.bundleDiscountAmount) > 0 && (
                <div className="panel-row"><dt>{order.bundleLabel ?? "Bundle offer"}</dt><dd className="text-veg">−{money(order.bundleDiscountAmount)}</dd></div>
              )}
              {decimalToPaise(order.discountAmount) > 0 && (
                <div className="panel-row"><dt>Discount {order.couponCode && `(${order.couponCode})`}</dt><dd className="text-veg">−{money(order.discountAmount)}</dd></div>
              )}
              <div className="panel-row"><dt>Delivery</dt><dd>{decimalToPaise(order.shippingAmount) === 0 ? "Free" : money(order.shippingAmount)}</dd></div>
              <div className="panel-row text-ink-faint"><dt>of which GST</dt><dd>{money(order.taxAmount)}</dd></div>
              <div className="panel-row font-display text-lead font-bold"><dt>Total</dt><dd>{money(order.totalAmount)}</dd></div>
            </dl>
          </section>

          <section>
            <h2 className="mb-3 text-h3 font-bold">Timeline</h2>
            {order.events.length === 0 ? (
              <p className="text-small text-ink-faint">No events recorded for this order.</p>
            ) : (
              <ol className="border-l-2 border-[--color-rule] pl-5">
                {order.events.map((e: any) => {
                  const d = describe(e);
                  return (
                    <li key={e.id} className="relative pb-5 last:pb-0">
                      <span
                        aria-hidden
                        className="absolute top-1.5 -left-[1.6rem] h-2.5 w-2.5 rounded-full border-2 border-paper"
                        style={{ background: d.warn ? "var(--color-alert)" : "var(--color-ink)" }}
                      />
                      <p className="text-small">
                        <span className={d.warn ? "font-semibold text-alert" : "font-semibold"}>{d.title}</span>
                        <span className="text-ink-faint"> · {actorLabel(e)} · {when.format(e.createdAt)}</span>
                      </p>
                      {d.body && <p className="mt-0.5 text-small whitespace-pre-line text-ink-soft">{d.body}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
            {canWrite && (
              <div className="mt-6">
                <OrderNoteForm orderId={order.id} />
              </div>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-6">
          {canWrite && (
            <section className="panel">
              <div className="panel-head">Update status</div>
              <div className="p-3.5">
                <OrderStatusForm
                  orderId={order.id}
                  current={order.status}
                  moves={allowedMoves({ status: order.status, paidOnline })}
                  tracking={order.trackingNumber}
                  courier={order.courierPartner}
                  blockedNote={
                    paidOnline && ["PAID", "PROCESSING"].includes(order.status)
                      ? "Paid online: cancelling needs a refund, which arrives with live Razorpay."
                      : null
                  }
                />
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">Customer</div>
            <div className="grid gap-1 p-3.5 text-small">
              <p className="font-semibold">{address.name}</p>
              <p className="break-words text-ink-soft">{order.guestEmail}</p>
              <p className="tabular text-ink-soft">{order.guestPhone}</p>
              <p className="mt-2 text-ink-soft">
                {address.line1}
                {address.line2 ? `, ${address.line2}` : ""}
                <br />
                {address.city}, {address.state} <span className="tabular">{address.postalCode}</span>
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">Payment</div>
            <dl>
              <div className="panel-row"><dt>Method</dt><dd>{order.paymentGateway === "COD" ? "Cash on delivery" : order.paymentGateway ?? "—"}</dd></div>
              <div className="panel-row"><dt>Status</dt><dd>{order.paymentStatus ?? "—"}</dd></div>
              {order.paymentId && <div className="panel-row"><dt>Razorpay order</dt><dd className="truncate text-micro">{order.paymentId}</dd></div>}
              {order.trackingNumber && <div className="panel-row"><dt>Tracking</dt><dd className="tabular">{order.trackingNumber}</dd></div>}
              {order.invoiceNumber && (
                <div className="panel-row">
                  <dt>Tax invoice</dt>
                  <dd>
                    <Link href={`/admin/orders/${order.id}/invoice`} className="tabular underline">
                      {order.invoiceNumber}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
