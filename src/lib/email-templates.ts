/**
 * Order-confirmation email: responsive HTML plus a plain-text twin.
 *
 * Table-based with inline styles, because email clients are not browsers
 * (Outlook renders with Word's engine; Gmail strips most <style> content). The
 * single media query only tightens padding on narrow screens — the layout is
 * fluid (width:100%, max-width:600px) so it still reads correctly in the
 * clients that ignore it.
 *
 * Every dynamic value is HTML-escaped. Names, addresses and product titles are
 * user- or admin-supplied and go straight into markup.
 *
 * Transactional only: it shows what was bought and charged, nothing promotional.
 */

import { formatINR } from "./money";
import { formatPercent } from "./pricing";
import { formatDate } from "./format";
import type { OrderBill } from "./order-bill";

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const INK = "#241c15";
const MUTED = "#8c7f73";
const SOFT = "#5b4f45";
const RULE = "#ddd3c5";
const GREEN = "#1f7a3d";

function billRows(bill: OrderBill): string {
  const items = bill.lines
    .map((l) => {
      const discounted = l.listUnitPaise > l.unitPaise;
      const unit = discounted
        ? `<span style="text-decoration:line-through;color:${MUTED}">${formatINR(l.listUnitPaise)}</span>&nbsp;${formatINR(l.unitPaise)}` +
          (l.percentOff ? ` <span style="color:${GREEN};font-weight:600">(${formatPercent(l.percentOff)}% off)</span>` : "")
        : formatINR(l.unitPaise);
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0ebe3;font-size:14px;line-height:1.4;color:${INK}">
          <strong>${esc(l.name)}</strong><br>
          <span style="font-size:13px;color:${SOFT}">${l.quantity} &times; ${unit}</span>
        </td>
        <td align="right" valign="top" style="padding:10px 0 10px 12px;border-bottom:1px solid #f0ebe3;font-size:14px;white-space:nowrap;color:${INK}">${formatINR(l.lineTotalPaise)}</td>
      </tr>`;
    })
    .join("");

  const row = (label: string, value: string, opts: { color?: string; bold?: boolean; size?: number } = {}) =>
    `<tr>
      <td style="padding:5px 0;font-size:${opts.size ?? 14}px;${opts.bold ? "font-weight:700;" : ""}color:${opts.color ?? SOFT}">${label}</td>
      <td align="right" style="padding:5px 0 5px 12px;font-size:${opts.size ?? 14}px;${opts.bold ? "font-weight:700;" : ""}white-space:nowrap;color:${opts.color ?? INK}">${value}</td>
    </tr>`;

  const summary = [
    bill.productDiscountPaise > 0 ? row("Items at original price", formatINR(bill.mrpSubtotalPaise)) : "",
    bill.productDiscountPaise > 0
      ? row("Product discounts", `&minus;${formatINR(bill.productDiscountPaise)}`, { color: GREEN })
      : "",
    bill.bundle ? row(`Combo savings: ${esc(bill.bundle.label)}`, `&minus;${formatINR(bill.bundle.amountPaise)}`, { color: GREEN }) : "",
    bill.coupon ? row(`Discount code ${esc(bill.coupon.code)}`, `&minus;${formatINR(bill.coupon.amountPaise)}`, { color: GREEN }) : "",
    row("Delivery", bill.shippingPaise === 0 ? "Free" : formatINR(bill.shippingPaise)),
  ].join("");

  return `${items}
    <tr><td colspan="2" style="padding-top:8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${summary}</table></td></tr>
    <tr>
      <td style="padding:12px 0 2px;border-top:2px solid ${INK};font-size:17px;font-weight:700;color:${INK}">${bill.cod ? "Total to pay" : "Total paid"}</td>
      <td align="right" style="padding:12px 0 2px;border-top:2px solid ${INK};font-size:17px;font-weight:700;white-space:nowrap;color:${INK}">${formatINR(bill.totalPaise)}</td>
    </tr>
    <tr>
      <td colspan="2" style="padding:0 0 4px;font-size:12px;color:${MUTED}">Includes GST of ${formatINR(bill.taxPaise)}</td>
    </tr>`;
}

/**
 * An email button built as a table cell with a background colour, so it still
 * renders as a button in Outlook, which ignores most CSS on links.
 */
export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr>
    <td style="background:${INK};border-radius:4px">
      <a href="${esc(href)}" style="display:inline-block;padding:12px 20px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none">${esc(label)}</a>
    </td></tr></table>`;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** `orderUrl` is the customer's private order link; null for orders without one. */
export function renderOrderConfirmation(bill: OrderBill, orderUrl?: string | null): RenderedEmail {
  const subject = `Your SooulOne order ${bill.orderNumber} is confirmed`;
  const statusLine = bill.cod
    ? "You'll pay the courier when it arrives."
    : "Your payment has gone through.";

  const savings =
    bill.totalSavingsPaise > 0
      ? `<p style="margin:0 0 20px;padding:10px 14px;background:#eaf5ed;color:${GREEN};font-size:14px;font-weight:600;border-radius:4px">
           You saved ${formatINR(bill.totalSavingsPaise)} on this order.
         </p>`
      : "";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${esc(subject)}</title>
  <style>
    @media only screen and (max-width:620px){
      .outer{padding:12px !important}
      .card{border-left:0 !important;border-right:0 !important}
      .pad{padding-left:16px !important;padding-right:16px !important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f2ede4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Order ${esc(bill.orderNumber)} — total ${formatINR(bill.totalPaise)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="outer" style="padding:24px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="max-width:600px;background:#ffffff;border:1px solid ${RULE}">
        <tr><td class="pad" style="padding:24px 24px 0">
          <p style="margin:0;font-size:18px;font-weight:700;letter-spacing:-0.3px">SooulOne</p>
        </td></tr>
        <tr><td class="pad" style="padding:16px 24px 8px">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:700">Thanks, your order is confirmed</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:${SOFT}">
            Order <strong style="color:${INK}">${esc(bill.orderNumber)}</strong>, placed ${esc(formatDate(bill.placedAt))}. ${statusLine}
          </p>
          ${savings}
          ${orderUrl ? emailButton(orderUrl, "View your order") : ""}
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED}">Your bill</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
            ${billRows(bill)}
          </table>
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED}">Delivering to</p>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:${SOFT}">
            ${[bill.address.name, ...bill.address.lines].filter(Boolean).map(esc).join("<br>")}
          </p>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${MUTED}">
            We send the longest-dated stock that meets the delivery freshness rule, so what arrives
            will have plenty of life left on it. We'll email again the moment it ships.
          </p>
        </td></tr>
        <tr><td class="pad" style="padding:16px 24px 24px;border-top:1px solid ${RULE};font-size:12px;color:${MUTED}">
          <p style="margin:0">You're receiving this because you placed an order with us. This is a service message about that order, not marketing.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Thanks, your order is confirmed.`,
    ``,
    `Order ${bill.orderNumber}, placed ${formatDate(bill.placedAt)}.`,
    statusLine,
    ...(orderUrl ? [``, `View your order: ${orderUrl}`] : []),
    ``,
    `YOUR BILL`,
    ...bill.lines.map((l) => {
      const unit =
        l.listUnitPaise > l.unitPaise
          ? `${formatINR(l.unitPaise)} (was ${formatINR(l.listUnitPaise)}${l.percentOff ? `, ${formatPercent(l.percentOff)}% off` : ""})`
          : formatINR(l.unitPaise);
      return `  ${l.name}\n    ${l.quantity} x ${unit} = ${formatINR(l.lineTotalPaise)}`;
    }),
    ``,
    ...(bill.productDiscountPaise > 0
      ? [`  Items at original price: ${formatINR(bill.mrpSubtotalPaise)}`, `  Product discounts: -${formatINR(bill.productDiscountPaise)}`]
      : []),
    ...(bill.bundle ? [`  Combo savings (${bill.bundle.label}): -${formatINR(bill.bundle.amountPaise)}`] : []),
    ...(bill.coupon ? [`  Discount code ${bill.coupon.code}: -${formatINR(bill.coupon.amountPaise)}`] : []),
    `  Delivery: ${bill.shippingPaise === 0 ? "Free" : formatINR(bill.shippingPaise)}`,
    `  ${bill.cod ? "TOTAL TO PAY" : "TOTAL PAID"}: ${formatINR(bill.totalPaise)} (includes GST of ${formatINR(bill.taxPaise)})`,
    ...(bill.totalSavingsPaise > 0 ? [``, `You saved ${formatINR(bill.totalSavingsPaise)} on this order.`] : []),
    ``,
    `Delivering to:`,
    ...[bill.address.name, ...bill.address.lines].filter(Boolean).map((l) => `  ${l}`),
    ``,
    `We'll email again the moment it ships.`,
  ].join("\n");

  return { subject, html, text };
}
