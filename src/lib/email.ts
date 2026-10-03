import "server-only";
import { Resend } from "resend";
import { buildOrderBill } from "./order-bill";
import { emailButton, esc, renderOrderConfirmation } from "./email-templates";
import { orderStatusUrl } from "./order-access";
import { reportError } from "@/lib/observability";
import { isUndeliverableTestAddress } from "./email-recipient";
import type { ShippingNoticeOrder, StoredOrder } from "./stored-order";

/**
 * Transactional email.
 *
 * ---------------------------------------------------------------------------
 * TRANSACTIONAL IS NOT MARKETING
 * ---------------------------------------------------------------------------
 * Everything in this file is transactional: it exists because the customer
 * did something and needs to know what happened. Those go to every customer
 * regardless of `marketingConsent`, because an order confirmation is not a
 * promotion and withholding it would be user-hostile.
 *
 * The inverse matters more. `marketingConsent` gates offers, launches and
 * win-backs, and nothing in this file may ever be used as a vehicle for them.
 * The moment an order confirmation carries a discount code for something
 * unrelated, it stops being transactional and starts needing consent — which
 * is exactly the line Section 8.5 of the brief draws.
 *
 * ---------------------------------------------------------------------------
 * FAILURE IS NEVER FATAL
 * ---------------------------------------------------------------------------
 * A paid order is worth far more than a sent email. Every function here
 * swallows its own errors and reports them to the server log rather than
 * throwing, so a Resend outage cannot roll back a transaction or 500 a
 * checkout that already took the customer's money.
 *
 * With no RESEND_API_KEY configured the whole module degrades to logging what
 * it *would* have sent. That keeps local development working without an email
 * account, and makes the gap visible rather than silent.
 */

const FROM = process.env.EMAIL_FROM ?? "SooulOne <orders@soulone.in>";

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

interface Sent {
  delivered: boolean;
  reason?: string;
}

async function send(to: string, subject: string, html: string, text: string): Promise<Sent> {
  // Test orders use addresses like x@soulone.test; mailing them only bounces.
  if (isUndeliverableTestAddress(to)) {
    console.info(`[email] skipped "${subject}" to test address ${to}`);
    return { delivered: false, reason: "test_address" };
  }

  const resend = client();

  if (!resend) {
    console.info(
      `[email] RESEND_API_KEY not set — would have sent "${subject}" to ${to}. ` +
        `Set it in .env.local to send for real.`,
    );
    return { delivered: false, reason: "not_configured" };
  }

  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html, text });
    if (error) {
      reportError("email", error, { subject, stage: "rejected" });
      return { delivered: false, reason: String(error) };
    }
    return { delivered: true };
  } catch (error) {
    reportError("email", error, { subject, stage: "threw" });
    return { delivered: false, reason: "exception" };
  }
}

/* ------------------------------------------------------------------ layout */

/**
 * Deliberately plain, table-based HTML with inline styles.
 *
 * Email clients are not browsers — Outlook renders with Word's engine, Gmail
 * strips <style> blocks, and flexbox is unreliable across all of them. A
 * boring table renders the same everywhere, and a receipt is the wrong place
 * to gamble on layout. Every message also ships a plain-text alternative,
 * which is both an accessibility and a deliverability matter: HTML-only mail
 * scores worse with spam filters.
 */
const ORDER_FOOTER = "You're receiving this because you placed an order with us. This is a service message about that order, not marketing.";

function wrap(heading: string, bodyHtml: string, footer: string = ORDER_FOOTER): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f2ede4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#241c15">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #ddd3c5">
    <tr><td style="padding:24px 24px 0">
      <p style="margin:0;font-size:18px;font-weight:700;letter-spacing:-0.3px">SooulOne</p>
    </td></tr>
    <tr><td style="padding:16px 24px 24px">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.2;font-weight:700">${heading}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:16px 24px 24px;border-top:1px solid #ddd3c5;font-size:12px;color:#8c7f73">
      <p style="margin:0">${footer}</p>
    </td></tr>
  </table>
</body></html>`;
}

/* ----------------------------------------------------------------- senders */

export async function sendOrderConfirmation(order: StoredOrder): Promise<Sent> {
  const to = order.guestEmail ?? order.customer?.email;
  // Email is optional at checkout: no address, nothing to send (shown as such on the order's timeline).
  if (!to) return { delivered: false, reason: "no_recipient" };

  const { subject, html, text } = renderOrderConfirmation(
    buildOrderBill(order),
    orderStatusUrl(order.orderNumber, order.accessToken),
  );
  return send(to, subject, html, text);
}

export async function sendShippingNotification(order: ShippingNoticeOrder): Promise<Sent> {
  const to = order.guestEmail ?? order.customer?.email;
  if (!to) return { delivered: false, reason: "no_recipient" };

  const tracking = order.trackingNumber;
  const orderUrl = orderStatusUrl(order.orderNumber, order.accessToken);

  // Tracking number and courier are typed by staff, so they're escaped like
  // any other text that ends up in HTML.
  const html = wrap(
    "Your order is on its way",
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.5">
       Order <strong>${esc(order.orderNumber)}</strong> has left us.
     </p>
     ${
       tracking
         ? `<p style="margin:0 0 16px;font-size:15px">
              Tracking number: <strong>${esc(tracking)}</strong>
              ${order.courierPartner ? `<br><span style="color:#5b4f45;font-size:14px">via ${esc(order.courierPartner)}</span>` : ""}
            </p>`
         : `<p style="margin:0 0 16px;font-size:14px;color:#5b4f45">
              We'll add a tracking number here as soon as the courier provides one.
            </p>`
     }
     ${orderUrl ? emailButton(orderUrl, "Track your order") : ""}
     <p style="margin:0;font-size:13px;color:#8c7f73">
       If anything arrives damaged or isn't what you expected, reply to this email and we'll sort it.
     </p>`,
  );

  const text = [
    `Your order is on its way.`,
    ``,
    `Order ${order.orderNumber} has left us.`,
    tracking ? `Tracking number: ${tracking}` : `We'll add tracking as soon as we have it.`,
    ...(orderUrl ? [`Track your order: ${orderUrl}`] : []),
    ``,
    `If anything arrives damaged, reply to this email and we'll sort it.`,
  ].join("\n");

  return send(to, `Your SooulOne order ${order.orderNumber} has shipped`, html, text);
}

/**
 * Near-expiry alert to the owner.
 *
 * Internal, not customer-facing. Sent to OWNER_ALERT_EMAIL so the person who
 * can actually act on short-dated stock hears about it without having to
 * remember to open the dashboard.
 */
export async function sendNearExpiryAlert(
  batches: { productName: string; batchNumber: string; quantityRemaining: number; daysUntilUnsellable: number }[],
): Promise<Sent> {
  const to = process.env.OWNER_ALERT_EMAIL;
  if (!to) return { delivered: false, reason: "not_configured" };
  if (batches.length === 0) return { delivered: false, reason: "nothing_to_report" };

  const rows = batches
    .map(
      (b) =>
        `<tr>
           <td style="padding:6px 0;border-bottom:1px solid #f0ebe3;font-size:14px">${b.productName} <span style="color:#8c7f73">${b.batchNumber}</span></td>
           <td style="padding:6px 0;border-bottom:1px solid #f0ebe3;font-size:14px;text-align:right">${b.quantityRemaining} left &middot; ${
             b.daysUntilUnsellable <= 0 ? "unsellable now" : `${b.daysUntilUnsellable} days`
           }</td>
         </tr>`,
    )
    .join("");

  const html = wrap(
    "Stock approaching unsellable",
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.5">
       These batches are close to the point where they can no longer be shipped. That happens
       well before the printed best-before date, so there is still time to move them through
       the stores or discount them.
     </p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
  );

  const text = [
    `Stock approaching unsellable.`,
    ``,
    ...batches.map(
      (b) =>
        `  ${b.productName} (${b.batchNumber}): ${b.quantityRemaining} left, ${
          b.daysUntilUnsellable <= 0 ? "unsellable now" : `${b.daysUntilUnsellable} days`
        }`,
    ),
  ].join("\n");

  return send(to, `SooulOne: ${batches.length} batch(es) approaching unsellable`, html, text);
}

/**
 * A new contact-form message, to the owner (OWNER_ALERT_EMAIL, else the
 * customer care address). Everything the sender typed is escaped. Reply-to is
 * not set to the sender: the inbox under Settings → Enquiries is the record.
 */
export async function sendEnquiryNotice(
  to: string | null,
  enquiry: { kind: string; name: string; email: string; phone: string | null; organisation: string | null; country: string | null; message: string },
): Promise<Sent> {
  if (!to) return { delivered: false, reason: "not_configured" };
  const rows = [
    ["From", `${enquiry.name} <${enquiry.email}>`],
    ["Phone", enquiry.phone],
    ["Organisation", enquiry.organisation],
    ["Country", enquiry.country],
  ].filter((r): r is [string, string] => Boolean(r[1]));
  const html = wrap(
    `New enquiry: ${esc(enquiry.kind)}`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 16px">${rows
      .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#8c7f73">${k}</td><td style="padding:2px 0">${esc(v)}</td></tr>`)
      .join("")}</table>
     <p style="margin:0;font-size:15px;line-height:1.5;white-space:pre-line">${esc(enquiry.message)}</p>`,
    "Sent from the contact form on the SooulOne website. Answer it from the console under Enquiries.",
  );
  const text = [`New enquiry: ${enquiry.kind}`, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", enquiry.message].join("\n");
  return send(to, `New enquiry: ${enquiry.kind} from ${enquiry.name}`, html, text);
}

/**
 * A new order, to the owner (M9): COD orders when placed, online orders when
 * the payment is captured. The order number, total, how it's paid, what's in
 * it, the pincode and its RTO risk band, with a link to the console. No
 * customer name, phone or address: those stay in the console.
 */
export async function sendNewOrderAlert(
  to: string | null,
  order: { orderNumber: string; totalPaise: number; method: "COD" | "ONLINE"; items: { name: string; quantity: number }[]; pincode: string | null; riskBand: string | null; consoleUrl: string },
): Promise<Sent> {
  if (!to) return { delivered: false, reason: "not_configured" };
  const total = `₹${(order.totalPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const method = order.method === "COD" ? "Cash on delivery" : "Paid online";
  const rows = order.items
    .map((i) => `<tr><td style="padding:4px 0;font-size:14px">${esc(i.name)}</td><td style="padding:4px 0;font-size:14px;text-align:right">× ${i.quantity}</td></tr>`)
    .join("");
  const facts = [method, order.pincode && `Pincode ${esc(order.pincode)}`, order.riskBand && `RTO risk: ${esc(order.riskBand)}`].filter(Boolean).join(" · ");
  const html = wrap(
    `New order ${esc(order.orderNumber)}: ${total}`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${facts}</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${rows}</table>
     ${emailButton(order.consoleUrl, "Open in the console")}`,
    "Sent because a new order was placed on your store. Customer details are in the console.",
  );
  const text = [`New order ${order.orderNumber}: ${total}`, facts.replace(/<[^>]+>/g, ""), "", ...order.items.map((i) => `  ${i.name} × ${i.quantity}`), "", order.consoleUrl].join("\n");
  return send(to, `New order ${order.orderNumber} · ${total} · ${method}`, html, text);
}

/**
 * A refill reminder (benchmark gap R2), only to a shopper who asked for one
 * on their order. It names what's running low and when, offers the same
 * order again, and carries a one-tap stop link. No offers or other products:
 * it's the reminder they asked for, nothing more.
 */
export async function sendRefillReminderEmail(
  to: string,
  reminder: { orderNumber: string; items: string[]; runOutLabel: string; orderUrl: string; stopUrl: string },
): Promise<Sent> {
  const what = reminder.items.length === 1 ? reminder.items[0] : "Your gummies";
  const list = reminder.items.map((i) => `<li style="margin:0 0 4px">${esc(i)}</li>`).join("");
  const html = wrap(
    `${esc(what)} ${reminder.items.length === 1 ? "runs" : "run"} out around ${esc(reminder.runOutLabel)}`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">
       By our count, what you ordered in <strong>${esc(reminder.orderNumber)}</strong> runs out around ${esc(reminder.runOutLabel)}, going by the daily amount on the pack:
     </p>
     <ul style="margin:0 0 16px;padding-left:20px;font-size:15px">${list}</ul>
     <p style="margin:0 0 16px;font-size:14px;color:#5b4f45">Order now and it should arrive before you run out. Delivery takes 2 to 4 days.</p>
     ${emailButton(reminder.orderUrl, "Order the same again")}`,
    `You asked for this reminder on order ${esc(reminder.orderNumber)}, and it's the only one for that order. <a href="${esc(reminder.stopUrl)}" style="color:#8c7f73">Stop refill reminders</a>.`,
  );
  const text = [
    `${what} ${reminder.items.length === 1 ? "runs" : "run"} out around ${reminder.runOutLabel}.`,
    "",
    `By our count, what you ordered in ${reminder.orderNumber} runs out around ${reminder.runOutLabel}:`,
    ...reminder.items.map((i) => `  - ${i}`),
    "",
    `Order the same again: ${reminder.orderUrl}`,
    "",
    `You asked for this reminder on order ${reminder.orderNumber}. Stop refill reminders: ${reminder.stopUrl}`,
  ].join("\n");
  return send(to, `${what} ${reminder.items.length === 1 ? "runs" : "run"} out around ${reminder.runOutLabel}`, html, text);
}

/**
 * A supplier's FSSAI licence is about to expire, or has (src/server/suppliers.ts).
 * To the owner. Buying from an unlicensed vendor breaches the licence
 * conditions, and live products show this licence number on their pages.
 */
export async function sendSupplierLicenceAlert(
  to: string,
  alert: { supplier: string; licence: string; expiresOn: Date; daysLeft: number; liveProducts: number; consoleUrl: string },
): Promise<Sent> {
  const date = alert.expiresOn.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const when = alert.daysLeft < 0 ? `expired on ${date}` : alert.daysLeft === 0 ? `expires today (${date})` : `expires on ${date}, in ${alert.daysLeft} ${alert.daysLeft === 1 ? "day" : "days"}`;
  const products = alert.liveProducts > 0 ? `${alert.liveProducts} live ${alert.liveProducts === 1 ? "product shows" : "products show"} this licence number on ${alert.liveProducts === 1 ? "its page" : "their pages"}.` : "";
  const html = wrap(
    `${esc(alert.supplier)}: FSSAI licence ${esc(when)}`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">
       The FSSAI licence of <strong>${esc(alert.supplier)}</strong> (no. ${esc(alert.licence)}) ${esc(when)}.
       ${esc(products)}
     </p>
     <p style="margin:0 0 16px;font-size:14px;color:#5b4f45">Ask them for the renewed licence and enter its number and new expiry date under Suppliers. Until then, don't buy from them: FSSAI licence conditions require buying only from licensed vendors.</p>
     ${emailButton(alert.consoleUrl, "Open Suppliers")}`,
    "Sent because a supplier's licence is close to expiring. You'll hear again 14 days before.",
  );
  const text = [`${alert.supplier}: FSSAI licence ${when}.`, `Licence no. ${alert.licence}.`, products, "", "Enter the renewed licence under Suppliers:", alert.consoleUrl].join("\n");
  return send(to, `${alert.supplier}: FSSAI licence ${alert.daysLeft < 0 ? "has expired" : `expires in ${Math.max(0, alert.daysLeft)} days`}`, html, text);
}

/**
 * A recall notice to someone who bought a recalled batch (src/server/recall.ts).
 * A safety notice, so it goes whatever their marketing choices: the text is
 * the owner's, as checked on the recall page.
 */
export async function sendRecallNoticeEmail(
  to: string,
  recall: { product: string; batchNumber: string; orderNumber: string; notice: string; contact: string | null },
): Promise<Sent> {
  const paragraphs = recall.notice.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;white-space:pre-line">${esc(p)}</p>`).join("");
  const html = wrap(
    `Recall: ${esc(recall.product)}, batch ${esc(recall.batchNumber)}`,
    `<p style="margin:0 0 12px;font-size:14px;color:#5b4f45">You bought this batch in order <strong>${esc(recall.orderNumber)}</strong>.</p>
     ${paragraphs}
     ${recall.contact ? `<p style="margin:0;font-size:14px">Contact us: ${esc(recall.contact)}</p>` : ""}`,
    `A product safety notice about order ${esc(recall.orderNumber)}. Not marketing.`,
  );
  const text = [`Recall: ${recall.product}, batch ${recall.batchNumber}`, `You bought this batch in order ${recall.orderNumber}.`, "", recall.notice, "", ...(recall.contact ? [`Contact us: ${recall.contact}`] : [])].join("\n");
  return send(to, `Important: recall of ${recall.product}, batch ${recall.batchNumber}`, html, text);
}
