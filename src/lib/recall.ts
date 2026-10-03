/**
 * The recall list (FSSAI Food Recall Procedure Regulations 2017): everyone
 * who received a batch, grouped by what to do about them, plus the drafts of
 * the notices to buyers and to the authority. Pure, so it's tested directly
 * (tests/recall-list.test.ts); the page is /admin/batches/[id].
 */

export type RecipientGroup = "hold" | "customer" | "returned";

export const GROUP_LABEL: Record<RecipientGroup, { title: string; action: string }> = {
  hold: { title: "Not shipped yet", action: "Stop these: take the batch out of the parcel before it goes." },
  customer: { title: "With customers", action: "Tell these buyers to stop using it." },
  returned: { title: "Came back to us", action: "Set these packs aside with the recalled stock." },
};

/** Which group an order's status puts it in, or null when the goods never left (cancelled, unpaid). */
export function groupOf(status: string): RecipientGroup | null {
  switch (status) {
    case "PAID":
    case "PROCESSING":
      return "hold";
    case "SHIPPED":
    case "DELIVERED":
      return "customer";
    case "RTO":
    case "RETURNED":
    case "REFUNDED":
      return "returned";
    default:
      return null;
  }
}

export interface RecipientRow {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly placedAt: Date;
  readonly status: string;
  readonly group: RecipientGroup;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly city: string;
  readonly pincode: string;
  readonly quantity: number;
}

interface ItemLike {
  readonly quantity: number;
  readonly order: {
    readonly id: string;
    readonly orderNumber: string;
    readonly placedAt: Date;
    readonly status: string;
    readonly guestPhone: string | null;
    readonly guestEmail: string | null;
    readonly postalCode: string | null;
    readonly shippingAddress: unknown;
    readonly customer: { readonly email: string | null } | null;
  };
}

const text = (o: unknown, key: string) => (o && typeof o === "object" && typeof (o as Record<string, unknown>)[key] === "string" ? ((o as Record<string, unknown>)[key] as string) : "");

/** One row per order that received the batch (an order's units can span several lines), newest first. */
export function recipients(items: readonly ItemLike[]): RecipientRow[] {
  const byOrder = new Map<string, RecipientRow>();
  for (const { quantity, order } of items) {
    const group = groupOf(order.status);
    if (!group) continue;
    const cur = byOrder.get(order.id);
    if (cur) {
      byOrder.set(order.id, { ...cur, quantity: cur.quantity + quantity });
      continue;
    }
    byOrder.set(order.id, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      placedAt: order.placedAt,
      status: order.status,
      group,
      name: text(order.shippingAddress, "name"),
      phone: order.guestPhone,
      email: order.guestEmail ?? order.customer?.email ?? null,
      city: text(order.shippingAddress, "city"),
      pincode: order.postalCode ?? text(order.shippingAddress, "postalCode"),
      quantity,
    });
  }
  return [...byOrder.values()].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime());
}

/** A spreadsheet cell: quoted, and never read as a formula (a name like "=HYPERLINK(...)" stays text). */
function cell(value: string | number | null): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function recipientsCsv(rows: readonly RecipientRow[], batch: { product: string; batchNumber: string }): string {
  const head = ["Product", "Batch", "Order", "Placed (IST)", "Status", "What to do", "Name", "Phone", "Email", "City", "Pincode", "Units"];
  const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
  const lines = rows.map((r) =>
    [batch.product, batch.batchNumber, r.orderNumber, ist(r.placedAt), r.status, GROUP_LABEL[r.group].title, r.name, r.phone, r.email, r.city, r.pincode, r.quantity].map(cell).join(","),
  );
  // A byte-order mark so Excel opens names in Gujarati or Hindi correctly.
  return "﻿" + [head.map(cell).join(","), ...lines].join("\r\n") + "\r\n";
}

/** The notice to buyers, as the owner first sees it (editable before sending). */
export function defaultBuyerNotice(batch: { product: string; batchNumber: string; reason: string | null }): string {
  return [
    `We are recalling ${batch.product}, batch ${batch.batchNumber}, as a precaution.`,
    batch.reason ? `Why: ${batch.reason}` : null,
    "",
    "Please stop using it. You can find the batch number printed on the pack.",
    "Reply to this email or contact us and we will refund you in full or send a replacement from another batch. You don't need to send the pack back unless we ask.",
    "",
    "We're sorry for the trouble.",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

/** A draft of the notice to the food safety authority, from the figures (for the owner to check and send). */
export function authorityNoticeDraft(f: {
  product: string;
  batchNumber: string;
  manufacturedOn: Date;
  expiresOn: Date;
  manufacturer: string | null;
  manufacturerLicence: string | null;
  seller: string;
  sellerLicence: string | null;
  reason: string | null;
  received: number;
  remaining: number;
  rows: readonly RecipientRow[];
}): string {
  const d = (x: Date) => x.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const sum = (g: RecipientGroup) => f.rows.filter((r) => r.group === g).reduce((n, r) => n + r.quantity, 0);
  const orders = (g: RecipientGroup) => f.rows.filter((r) => r.group === g).length;
  const n = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;
  const line = (g: RecipientGroup) => `${n(sum(g), "unit")} in ${n(orders(g), "order")}`;
  const placed = f.rows.map((r) => r.placedAt.getTime());
  return [
    "To: The Food Safety Officer / Designated Officer",
    `Subject: Recall of ${f.product}, batch ${f.batchNumber}`,
    "",
    `Food business operator: ${f.seller}${f.sellerLicence ? `, FSSAI licence no. ${f.sellerLicence}` : ""}`,
    `Manufacturer: ${f.manufacturer ?? "(not recorded)"}${f.manufacturerLicence ? `, FSSAI licence no. ${f.manufacturerLicence}` : ""}`,
    `Product and batch: ${f.product}, batch ${f.batchNumber}, manufactured ${d(f.manufacturedOn)}, best before ${d(f.expiresOn)}`,
    `Reason for recall: ${f.reason ?? "(state the reason)"}`,
    "",
    `Quantity received: ${n(f.received, "unit")}. Still in our stock and withdrawn from sale: ${n(f.remaining, "unit")}.`,
    `Sold online and with customers: ${line("customer")}.`,
    `Sold but stopped before dispatch: ${line("hold")}.`,
    `Returned to us: ${line("returned")}.`,
    placed.length ? `Orders placed between ${d(new Date(Math.min(...placed)))} and ${d(new Date(Math.max(...placed)))}, all delivered within Gujarat.` : "No orders received this batch.",
    "",
    "Customers have been / are being notified by email and phone. A list of recipients is available on request.",
  ].join("\n");
}
