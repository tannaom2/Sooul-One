import type { Invoice } from "@/lib/invoice";

/**
 * The console's spreadsheet downloads (benchmark gap M2): orders, the GST
 * register with its HSN summary, and stock. Pure, so every column is tested
 * (tests/exports.test.ts); loading and permissions are in src/server/exports.ts
 * and the routes under /admin.
 */

type Cell = string | number | null | undefined;

/** Quote a cell, and stop spreadsheet apps treating a leading =, +, - or @ as a formula. */
export function csvCell(value: Cell): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** A whole file: a byte-order mark so Excel reads ₹ and Indian names right, and Windows line ends. */
export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const IST_MS = 5.5 * 60 * 60 * 1000;
/** yyyy-mm-dd in India time. */
export const istDate = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
/** yyyy-mm-dd hh:mm in India time. */
export const istDateTime = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 16).replace("T", " ");
/** Rupees with two decimals, as accountants expect, from paise. */
export const rupees = (paise: number) => (paise / 100).toFixed(2);

/** The first and last moment of an India-time calendar month ("2026-09"), as UTC instants. */
export function istMonth(month: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const from = new Date(Date.UTC(y, mo - 1, 1) - IST_MS);
  const to = new Date(Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1) - IST_MS);
  return { from, to };
}

export interface OrderExportRow {
  readonly orderNumber: string;
  readonly placedAt: Date;
  readonly status: string;
  readonly paymentGateway: string | null;
  readonly paymentStatus: string | null;
  readonly items: number;
  readonly subtotalPaise: number;
  readonly discountPaise: number;
  readonly shippingPaise: number;
  readonly totalPaise: number;
  readonly name: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly city: string | null;
  readonly pincode: string | null;
  readonly courier: string | null;
  readonly tracking: string | null;
  readonly invoiceNumber: string | null;
  readonly closeReason: string | null;
}

export const ORDER_COLUMNS = [
  "Order",
  "Placed (IST)",
  "Status",
  "Payment",
  "Payment status",
  "Items",
  "Items value (INR)",
  "Discounts (INR)",
  "Delivery (INR)",
  "Total (INR)",
  "Customer",
  "Mobile",
  "Email",
  "City",
  "Pincode",
  "Courier",
  "Tracking",
  "Invoice",
  "Closed because",
] as const;

export function ordersCsv(orders: readonly OrderExportRow[]): string {
  return toCsv(
    ORDER_COLUMNS,
    orders.map((o) => [
      o.orderNumber,
      istDateTime(o.placedAt),
      o.status,
      o.paymentGateway === "COD" ? "Cash on delivery" : o.paymentGateway === "RAZORPAY" ? "Online" : o.paymentGateway,
      o.paymentStatus,
      o.items,
      rupees(o.subtotalPaise),
      rupees(o.discountPaise),
      rupees(o.shippingPaise),
      rupees(o.totalPaise),
      o.name,
      o.phone,
      o.email,
      o.city,
      o.pincode,
      o.courier,
      o.tracking,
      o.invoiceNumber,
      o.closeReason,
    ]),
  );
}

export interface InvoicedOrder {
  readonly invoiceNumber: string;
  readonly invoiceDate: Date;
  readonly orderNumber: string;
  readonly buyerName: string | null;
  readonly placeOfSupply: string | null;
  readonly status: string;
  readonly invoice: Invoice;
}

export const GST_COLUMNS = [
  "Invoice",
  "Invoice date (IST)",
  "Order",
  "Buyer",
  "Place of supply",
  "Order status now",
  "Item",
  "HSN",
  "Quantity",
  "Taxable value (INR)",
  "GST rate %",
  "CGST (INR)",
  "SGST (INR)",
  "IGST (INR)",
  "Line total (INR)",
] as const;

/** One row per invoice line (each product, and delivery), in invoice order. */
export function gstRegisterCsv(orders: readonly InvoicedOrder[]): string {
  return toCsv(
    GST_COLUMNS,
    orders.flatMap((o) =>
      o.invoice.lines.map((l) => [
        o.invoiceNumber,
        istDate(o.invoiceDate),
        o.orderNumber,
        o.buyerName,
        o.placeOfSupply,
        o.status,
        l.description,
        l.hsn,
        l.quantity,
        rupees(l.taxablePaise),
        l.ratePercent,
        rupees(l.cgstPaise),
        rupees(l.sgstPaise),
        rupees(l.igstPaise),
        rupees(l.totalPaise),
      ]),
    ),
  );
}

export const HSN_COLUMNS = ["HSN", "GST rate %", "Quantity", "Taxable value (INR)", "CGST (INR)", "SGST (INR)", "IGST (INR)", "Total (INR)"] as const;

/** Totals per HSN code and rate, for GSTR-1's HSN summary. Delivery has no HSN and shows as "Delivery (SAC)". */
export function hsnSummaryCsv(orders: readonly InvoicedOrder[]): string {
  const rows = new Map<string, { hsn: string; rate: number; qty: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }>();
  for (const line of orders.flatMap((o) => o.invoice.lines)) {
    const hsn = line.hsn ?? (line.quantity === null ? "Delivery (SAC)" : "Missing");
    const key = `${hsn}|${line.ratePercent}`;
    const r = rows.get(key) ?? { hsn, rate: line.ratePercent, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    r.qty += line.quantity ?? 0;
    r.taxable += line.taxablePaise;
    r.cgst += line.cgstPaise;
    r.sgst += line.sgstPaise;
    r.igst += line.igstPaise;
    r.total += line.totalPaise;
    rows.set(key, r);
  }
  return toCsv(
    HSN_COLUMNS,
    [...rows.values()]
      .sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate)
      .map((r) => [r.hsn, r.rate, r.qty || null, rupees(r.taxable), rupees(r.cgst), rupees(r.sgst), rupees(r.igst), rupees(r.total)]),
  );
}

export interface StockExportRow {
  readonly product: string;
  readonly brand: string;
  readonly batchNumber: string;
  readonly supplier: string | null;
  readonly receivedOn: Date | null;
  readonly manufacturedOn: Date;
  readonly expiresOn: Date;
  readonly quantityReceived: number;
  readonly quantityRemaining: number;
  readonly recalled: boolean;
}

export const STOCK_COLUMNS = ["Product", "Brand", "Batch", "Supplier", "Received", "Made", "Best before", "Days to best before", "Received qty", "In stock", "Recalled"] as const;

export function stockCsv(rows: readonly StockExportRow[], now: Date): string {
  return toCsv(
    STOCK_COLUMNS,
    rows.map((b) => [
      b.product,
      b.brand,
      b.batchNumber,
      b.supplier,
      b.receivedOn ? istDate(b.receivedOn) : null,
      istDate(b.manufacturedOn),
      istDate(b.expiresOn),
      Math.floor((b.expiresOn.getTime() - now.getTime()) / 86_400_000),
      b.quantityReceived,
      b.quantityRemaining,
      b.recalled ? "yes" : "no",
    ]),
  );
}
