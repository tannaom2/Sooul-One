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
import { CLOSE_REASONS, STATUS_LABELS, allowedMoves, paymentStatusLabel } from "@/lib/order-lifecycle";
import { describeTouch, readAttribution, type Touch } from "@/lib/attribution";
import { MESSAGE_KINDS, reasonLabel as messageReason } from "@/lib/messages";
import { isReturned } from "@/lib/returns";
import { ReturnCheck } from "./return-check";

const reasonLabel = (code: string) =>
  Object.values(CLOSE_REASONS).flat().find((r) => r.code === code)?.label ?? code;

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

const EMAIL_LABEL: Record<string, string> = MESSAGE_KINDS;

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
      // Email is optional at checkout: nothing went wrong.
      if (d.reason === "no_recipient") return { title: `${EMAIL_LABEL[d.email] ?? "Email"} not sent`, body: "No email address on this order." };
      return {
        title: `${EMAIL_LABEL[d.email] ?? "Email"} ${d.delivered ? "sent" : "not sent"}`,
        // Sent through the message queue (src/server/messages.ts): retries are counted.
        body: d.delivered
          ? d.attempts ? `After ${d.attempts} tries.` : undefined
          : [d.reason === "not_configured" ? "Email isn't configured on this server." : messageReason(d.reason ?? null), d.attempts && `${d.attempts} tries; retry it from Messages`].filter(Boolean).join(" · ") || undefined,
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
      items: { include: { batch: { select: { batchNumber: true } }, returnCheck: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();
  // The packing run: the longest-waiting order still to pack, other than this one.
  const nextToPack = canWrite
    ? await db.order.findFirst({
        where: { status: { in: ["PAID", "PROCESSING"] }, id: { not: order.id } },
        orderBy: { placedAt: "asc" },
        select: { id: true, orderNumber: true },
      })
    : null;

  const paidOnline = order.paymentGateway === "RAZORPAY" && order.paymentStatus === "captured";
  const address = order.shippingAddress ?? {};
  const money = (v: unknown) => formatINR(decimalToPaise(v as any));

  return (
    <div className="grid gap-8">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <Link href="/admin/orders" className="text-small text-ink-soft hover:underline">
            ← All orders
          </Link>
          {nextToPack && (
            <Link href={`/admin/orders/${nextToPack.id}`} className="text-small font-semibold hover:underline">
              Next order to pack: <span className="tabular">{nextToPack.orderNumber}</span> →
            </Link>
          )}
        </div>
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
              {decimalToPaise(order.creditAmount) > 0 && (
                <div className="panel-row"><dt>{order.creditKind === "WELCOME" ? "Welcome offer (referral)" : "Referral credit"}</dt><dd className="text-veg">−{money(order.creditAmount)}</dd></div>
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
              <ol className="border-l-2 border-rule pl-5">
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
          {/* A parcel that came back is checked line by line before anything goes back on sale (src/lib/returns.ts). */}
          {isReturned(order.status) && (
            <ReturnCheck
              orderId={order.id}
              canWrite={canWrite}
              lines={order.items.map((i: any) => ({
                id: i.id,
                name: i.productNameSnapshot,
                batch: i.batch?.batchNumber ?? null,
                quantity: i.quantity,
                outcome: i.returnCheck?.outcome ?? null,
                note: i.returnCheck?.note ?? null,
                decidedBy: i.returnCheck?.decidedBy ?? null,
                decidedAt: i.returnCheck ? when.format(i.returnCheck.decidedAt) : null,
              }))}
            />
          )}
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
              <p className="break-words text-ink-soft">{order.guestEmail ?? <span className="text-ink-faint">No email given</span>}</p>
              <p className="text-ink-soft">
                <span className="tabular">{order.guestPhone}</span>
                {/* Proven by SMS code at checkout: the number is real and was in the shopper's hand. */}
                {order.phoneVerifiedAt ? (
                  <span className="ml-2 text-micro font-semibold text-veg">Verified by code</span>
                ) : (
                  <span className="ml-2 text-micro text-ink-faint">Not verified</span>
                )}
              </p>
              <p className="text-micro text-ink-faint">{order.customerId ? "Has an account" : "Guest checkout"}</p>
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
              <div className="panel-row"><dt>Status</dt><dd>{paymentStatusLabel(order.paymentStatus, order.paymentGateway)}</dd></div>
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

          <CameFrom value={order.attribution} />
        </aside>
      </div>
    </div>
  );
}

/** The visit before the order, and the first ever if different (src/lib/attribution.ts). */
function CameFrom({ value }: { value: unknown }) {
  const a = readAttribution(value);
  const row = (label: string, t: Touch) => (
    <div className="border-b border-rule px-3.5 py-2.5 last:border-b-0">
      <dt className="text-micro text-ink-faint">{label}</dt>
      <dd className="text-small">
        <span className="block break-words">{describeTouch(t)}</span>
        <span className="block text-micro text-ink-faint">
          {[t.term && `Term: ${t.term}`, t.content && `Ad: ${t.content}`, t.clickKind && `${t.clickKind} kept`, `Landed on ${t.landing}`, when.format(new Date(t.at))].filter(Boolean).join(" · ")}
        </span>
      </dd>
    </div>
  );
  return (
    <section className="panel">
      <div className="panel-head">Came from</div>
      {a ? (
        <dl>
          {row("Before ordering", a.last)}
          {a.first.at !== a.last.at && row("First visit", a.first)}
        </dl>
      ) : (
        <p className="p-3.5 text-small text-ink-soft">
          Not recorded: placed before visits were recorded, with cookies blocked, or after a visit on another device.
        </p>
      )}
    </section>
  );
}
