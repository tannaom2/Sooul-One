import "server-only";
import { db } from "@/lib/db";
import { sendEnquiryNotice, sendNewOrderAlert, sendOrderConfirmation, sendShippingNotification } from "@/lib/email";
import { decimalToPaise } from "@/lib/format";
import { riskBand } from "@/lib/intel/rto-risk";
import { ENQUIRY_KINDS } from "@/lib/validation/site-content";
import type { MessageKind, SendResult } from "@/lib/messages";
import { getBusinessProfile } from "@/server/business";
import { sendRefillReminder } from "@/server/refill-reminders";
import { sendLicenceReminder } from "@/server/suppliers";
import { sendRecallNotice } from "@/server/recall";
import { sendCheckIn, sendDeliveredNotice, sendRefundNotice, sendReviewRequest } from "@/server/follow-ups";
import { sendStockAlert } from "@/server/stock-alerts";

/**
 * One sender per message kind (src/lib/messages.ts). Each looks up what it
 * needs when the message goes, so a retry hours later sends today's facts
 * (a tracking number added since, an address corrected), and reports the
 * result in the shape src/lib/email.ts returns. A sender may throw; the queue
 * counts that as a failed attempt.
 */

type Payload = Record<string, unknown>;
const id = (p: Payload, key: string) => (typeof p[key] === "string" ? (p[key] as string) : null);

/** The account email, when there is one, in the shape the email senders take. */
const withAccountEmail = <T extends { customer: { email: string | null } | null }>(o: T) => ({ ...o, customer: o.customer?.email ? { email: o.customer.email } : null });

const BAND_LABEL: Record<string, string> = { LOW: "low", MEDIUM: "medium", HIGH: "high", VERY_HIGH: "very high" };

/** The owner's address for alerts: OWNER_ALERT_EMAIL, else customer care. */
async function ownerAddress(): Promise<string | null> {
  return process.env.OWNER_ALERT_EMAIL || (await getBusinessProfile()).customerCareEmail;
}

/**
 * The new-order email to the owner (M9): order number, total, how it's paid,
 * what's in it, the pincode and its RTO risk band, with a console link. No
 * customer name, phone or address.
 */
export async function sendOwnerNewOrderAlert(orderId: string): Promise<SendResult> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { orderNumber: true, totalAmount: true, paymentGateway: true, postalCode: true, riskScore: true, items: { select: { productNameSnapshot: true, quantity: true } } },
  });
  if (!order) return { delivered: false, reason: "not_found" };
  const site = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return sendNewOrderAlert(await ownerAddress(), {
    orderNumber: order.orderNumber,
    totalPaise: decimalToPaise(order.totalAmount),
    method: order.paymentGateway === "COD" ? "COD" : "ONLINE",
    items: order.items.map((i) => ({ name: i.productNameSnapshot, quantity: i.quantity })),
    pincode: order.postalCode,
    riskBand: order.riskScore == null ? null : BAND_LABEL[riskBand(order.riskScore)] ?? null,
    consoleUrl: `${site}/admin/orders/${orderId}`,
  });
}

export const SENDERS: Record<MessageKind, (payload: Payload, orderId: string | null) => Promise<SendResult>> = {
  async order_confirmation(_p, orderId) {
    const order = orderId ? await db.order.findUnique({ where: { id: orderId }, include: { items: true, customer: { select: { email: true } } } }) : null;
    return order ? sendOrderConfirmation(withAccountEmail(order)) : { delivered: false, reason: "not_found" };
  },

  async shipping_notification(_p, orderId) {
    const order = orderId ? await db.order.findUnique({ where: { id: orderId }, include: { customer: { select: { email: true } } } }) : null;
    return order ? sendShippingNotification(withAccountEmail(order)) : { delivered: false, reason: "not_found" };
  },

  async owner_new_order(_p, orderId) {
    return orderId ? sendOwnerNewOrderAlert(orderId) : { delivered: false, reason: "not_found" };
  },

  async enquiry_notice(p) {
    const enquiryId = id(p, "enquiryId");
    const enquiry = enquiryId ? await db.enquiry.findUnique({ where: { id: enquiryId } }) : null;
    if (!enquiry) return { delivered: false, reason: "not_found" };
    return sendEnquiryNotice(await ownerAddress(), { ...enquiry, kind: ENQUIRY_KINDS[enquiry.kind] ?? enquiry.kind });
  },

  async refill_reminder(p, orderId) {
    return sendRefillReminder(p, orderId);
  },

  async supplier_licence_expiry(p) {
    return sendLicenceReminder(p);
  },

  async recall_notice(p, orderId) {
    return sendRecallNotice(p, orderId);
  },

  async delivered_notice(_p, orderId) {
    return sendDeliveredNotice(orderId);
  },

  async check_in(_p, orderId) {
    return sendCheckIn(orderId);
  },

  async review_request(_p, orderId) {
    return sendReviewRequest(orderId);
  },

  async refund_notice(p, orderId) {
    return sendRefundNotice(p, orderId);
  },

  async back_in_stock(p) {
    return sendStockAlert(p);
  },
};
