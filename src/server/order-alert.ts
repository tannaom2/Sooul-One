import "server-only";
import { db } from "@/lib/db";
import { sendNewOrderAlert } from "@/lib/email";
import { recordOrderEvent } from "@/lib/order-events";
import { reportError } from "@/lib/observability";
import { decimalToPaise } from "@/lib/format";
import { riskBand } from "@/lib/intel/rto-risk";
import { getBusinessProfile } from "@/server/business";

const BAND_LABEL: Record<string, string> = { LOW: "low", MEDIUM: "medium", HIGH: "high", VERY_HIGH: "very high" };

/**
 * Email the owner about a new order (M9), to OWNER_ALERT_EMAIL, else the
 * customer care address. Called once an order is real: a COD order when
 * placed, an online order when its payment is captured. Never throws: an
 * alert failing must not touch the order.
 */
export async function alertOwnerNewOrder(orderId: string): Promise<void> {
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { orderNumber: true, totalAmount: true, paymentGateway: true, postalCode: true, riskScore: true, items: { select: { productNameSnapshot: true, quantity: true } } },
    });
    if (!order) return;
    const to = process.env.OWNER_ALERT_EMAIL || (await getBusinessProfile()).customerCareEmail;
    const site = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const sent = await sendNewOrderAlert(to, {
      orderNumber: order.orderNumber,
      totalPaise: decimalToPaise(order.totalAmount),
      method: order.paymentGateway === "COD" ? "COD" : "ONLINE",
      items: order.items.map((i) => ({ name: i.productNameSnapshot, quantity: i.quantity })),
      pincode: order.postalCode,
      riskBand: order.riskScore == null ? null : BAND_LABEL[riskBand(order.riskScore)] ?? null,
      consoleUrl: `${site}/admin/orders/${orderId}`,
    });
    await recordOrderEvent(orderId, "EMAIL_SENT", { type: "SYSTEM" }, { email: "owner_new_order", delivered: sent.delivered, reason: sent.reason ?? null });
  } catch (error) {
    reportError("owner-order-alert", error, { orderId });
  }
}
