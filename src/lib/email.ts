import "server-only";
import { Resend } from "resend";
import { buildOrderBill } from "./order-bill";
import { emailButton, esc, renderOrderConfirmation } from "./email-templates";
import { orderStatusUrl } from "./order-access";
import { reportError } from "@/lib/observability";

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
function wrap(heading: string, bodyHtml: string): string {
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
      <p style="margin:0">You're receiving this because you placed an order with us. This is a service message about that order, not marketing.</p>
    </td></tr>
  </table>
</body></html>`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ----------------------------------------------------------------- senders */

export async function sendOrderConfirmation(order: any): Promise<Sent> {
  const to = order.guestEmail ?? order.customer?.email;
  if (!to) {
    console.warn("[email] order has no address to send to", order.orderNumber);
    return { delivered: false, reason: "no_recipient" };
  }

  const { subject, html, text } = renderOrderConfirmation(
    buildOrderBill(order),
    orderStatusUrl(order.orderNumber, order.accessToken),
  );
  return send(to, subject, html, text);
}

export async function sendShippingNotification(order: any): Promise<Sent> {
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
