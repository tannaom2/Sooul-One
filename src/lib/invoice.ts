/**
 * GST tax invoice: numbering, and the invoice itself built from what the
 * order recorded at checkout (each line's taxable value and tax), so it
 * always matches what the customer was charged, whatever prices, rates or
 * offers say today. Pure, so it's tested directly. The page that renders it
 * is src/components/tax-invoice.tsx.
 *
 * Contents follow the GST invoice rules (Rule 46, CGST Rules 2017): supplier
 * name, address and GSTIN; a consecutive invoice number of at most 16
 * characters, unique per financial year; date; recipient name and address;
 * place of supply with state code; HSN; quantity; taxable value; rate and
 * amount of CGST and SGST (or IGST); and the total. Have your accountant
 * confirm the details before the first GST return.
 */

import { splitTaxInclusive, type GstTreatment } from "./money";

/** GST state codes, for "Place of supply: Gujarat (24)". */
export const GST_STATE_CODES: Record<string, string> = {
  "jammu and kashmir": "01", "himachal pradesh": "02", punjab: "03", chandigarh: "04", uttarakhand: "05",
  haryana: "06", delhi: "07", rajasthan: "08", "uttar pradesh": "09", bihar: "10", sikkim: "11",
  "arunachal pradesh": "12", nagaland: "13", manipur: "14", mizoram: "15", tripura: "16", meghalaya: "17",
  assam: "18", "west bengal": "19", jharkhand: "20", odisha: "21", chhattisgarh: "22", "madhya pradesh": "23",
  gujarat: "24", "dadra and nagar haveli and daman and diu": "26", maharashtra: "27", karnataka: "29",
  goa: "30", lakshadweep: "31", kerala: "32", "tamil nadu": "33", puducherry: "34",
  "andaman and nicobar islands": "35", telangana: "36", "andhra pradesh": "37", ladakh: "38",
};

export function stateCode(state: string | null | undefined): string | null {
  if (!state) return null;
  return GST_STATE_CODES[state.trim().toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ")] ?? null;
}

/** Indian financial year of a moment, in India's time zone: "2026-27" (1 April to 31 March). */
export function financialYear(at: Date): string {
  const ist = new Date(at.getTime() + 5.5 * 3600_000);
  const year = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "SO/26-27/000123": 15 characters, within GST's 16-character limit. */
export function formatInvoiceNumber(fy: string, n: number): string {
  return `SO/${fy.slice(2, 4)}-${fy.slice(5, 7)}/${String(n).padStart(6, "0")}`;
}

/**
 * Split a total into integer parts in proportion to weights, summing exactly
 * to the total (the last part takes the rounding). Used to divide a line's
 * taxable value and tax across the batches it was drawn from.
 */
export function apportion(totalPaise: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, i) => (i === weights.length - 1 ? totalPaise : 0));
  let given = 0;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return totalPaise - given;
    const part = Math.round((totalPaise * w) / sum);
    given += part;
    return part;
  });
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? "-" + ONES[n % 10] : ""}`;
}
function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}
function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  return [
    crore ? `${indianWords(crore)} Crore` : "",
    lakh ? `${belowHundred(lakh)} Lakh` : "",
    thousand ? `${belowHundred(thousand)} Thousand` : "",
    rest ? belowThousand(rest) : "",
  ].filter(Boolean).join(" ");
}

/** "Rupees Two Hundred Fifty-Eight and Fifty Paise Only", in the Indian system. */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${indianWords(rupees)}${p ? ` and ${belowHundred(p)} Paise` : ""} Only`;
}

export interface InvoiceItemInput {
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly hsnCode: string | null;
  readonly taxRatePercent: number | null;
  readonly quantity: number;
  /** What the customer paid for this row, tax included, after product discounts. */
  readonly lineTotalPaise: number;
  /** Recorded at checkout, after every discount. Null on orders from before that. */
  readonly taxablePaise: number | null;
  readonly taxPaise: number | null;
}

export interface InvoiceOrderInput {
  readonly gstTreatment: GstTreatment | null;
  readonly shippingPaise: number;
  readonly shippingTaxPaise: number | null;
  readonly totalPaise: number;
  readonly items: readonly InvoiceItemInput[];
}

export interface InvoiceLine {
  readonly description: string;
  readonly hsn: string | null;
  readonly quantity: number | null;
  readonly ratePercent: number;
  readonly taxablePaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly totalPaise: number;
}

export interface Invoice {
  readonly lines: readonly InvoiceLine[];
  readonly treatment: GstTreatment;
  readonly taxablePaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly totalPaise: number;
  readonly totalInWords: string;
  /** True when a line had to be worked out from today's rate (orders placed before tax was recorded). */
  readonly approximate: boolean;
}

/** Split one amount of tax the way checkout does: CGST takes the odd paisa. */
function splitTax(taxPaise: number, treatment: GstTreatment) {
  if (treatment === "INTER_STATE") return { cgstPaise: 0, sgstPaise: 0, igstPaise: taxPaise };
  const half = Math.floor(taxPaise / 2);
  return { cgstPaise: taxPaise - half, sgstPaise: half, igstPaise: 0 };
}

/** Delivery is taxed at this rate when the order didn't record its own figure. */
const FALLBACK_SHIPPING_RATE = 18;

export function buildInvoice(order: InvoiceOrderInput): Invoice {
  const treatment: GstTreatment = order.gstTreatment ?? "INTRA_STATE";
  let approximate = false;

  // One invoice line per product (an order line may be split across batches).
  const byProduct = new Map<string, InvoiceItemInput[]>();
  for (const item of order.items) byProduct.set(item.productId, [...(byProduct.get(item.productId) ?? []), item]);

  const lines: InvoiceLine[] = [...byProduct.values()].map((rows) => {
    const first = rows[0];
    const rate = first.taxRatePercent ?? 18;
    let taxable = 0;
    let tax = 0;
    for (const row of rows) {
      if (row.taxablePaise != null && row.taxPaise != null) {
        taxable += row.taxablePaise;
        tax += row.taxPaise;
      } else {
        approximate = true;
        const split = splitTaxInclusive(row.lineTotalPaise, rate, treatment);
        taxable += split.netPaise;
        tax += split.taxPaise;
      }
    }
    return {
      description: first.productNameSnapshot,
      hsn: first.hsnCode,
      quantity: rows.reduce((q, r) => q + r.quantity, 0),
      ratePercent: rate,
      taxablePaise: taxable,
      ...splitTax(tax, treatment),
      totalPaise: taxable + tax,
    };
  });

  if (order.shippingPaise > 0) {
    let shippingTax = order.shippingTaxPaise;
    if (shippingTax == null) {
      approximate = true;
      shippingTax = splitTaxInclusive(order.shippingPaise, FALLBACK_SHIPPING_RATE, treatment).taxPaise;
    }
    const taxable = order.shippingPaise - shippingTax;
    lines.push({
      description: "Delivery charges",
      hsn: null,
      quantity: null,
      ratePercent: taxable > 0 ? Math.round((shippingTax / taxable) * 100) : 0,
      taxablePaise: taxable,
      ...splitTax(shippingTax, treatment),
      totalPaise: order.shippingPaise,
    });
  }

  const sum = (key: "taxablePaise" | "cgstPaise" | "sgstPaise" | "igstPaise" | "totalPaise") =>
    lines.reduce((s, l) => s + l[key], 0);
  const total = sum("totalPaise");
  return {
    lines,
    treatment,
    taxablePaise: sum("taxablePaise"),
    cgstPaise: sum("cgstPaise"),
    sgstPaise: sum("sgstPaise"),
    igstPaise: sum("igstPaise"),
    totalPaise: total,
    totalInWords: amountInWords(total),
    approximate: approximate || total !== order.totalPaise,
  };
}
