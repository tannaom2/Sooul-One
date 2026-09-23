/**
 * Money and GST arithmetic.
 *
 * EVERYTHING HERE IS INTEGER PAISE. No monetary value is ever held in a float.
 * `0.1 + 0.2 !== 0.3` is not an abstract concern on an invoice: it produces
 * totals that disagree with the payment gateway by a paisa, and reconciling
 * those after the fact costs far more than the discipline of staying integral.
 * Prisma Decimal values cross this boundary via `toPaise` and go back out via
 * `fromPaise` at the edges only.
 */

export type Paise = number;

/** Indian GST splits by whether the supply crosses a state line. */
export type GstTreatment = "INTRA_STATE" | "INTER_STATE";

export function toPaise(rupees: string | number): Paise {
  const asString = typeof rupees === "number" ? rupees.toFixed(2) : rupees.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(asString)) {
    throw new RangeError(`Not a valid rupee amount: "${rupees}"`);
  }
  const negative = asString.startsWith("-");
  const [whole, fraction = ""] = asString.replace("-", "").split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -paise : paise;
}

export function fromPaise(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const value = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${value}` : value;
}

/** Indian digit grouping (2,2,3), not the Western 3,3,3. */
export function formatINR(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const whole = String(Math.floor(abs / 100));
  const fraction = String(abs % 100).padStart(2, "0");

  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;

  return `${negative ? "-" : ""}₹${grouped}.${fraction}`;
}

/**
 * Storefront price tag: whole rupees read "₹470/-", with paise only when there
 * are any ("₹470.50/-"). Display only; invoices and totals use `formatINR`.
 */
export function formatPriceTag(paise: Paise): string {
  const full = formatINR(paise);
  return `${full.endsWith(".00") ? full.slice(0, -3) : full}/-`;
}

/**
 * Split a discount across lines proportionally to their gross.
 *
 * Uses largest-remainder so the parts sum to the whole exactly. Allocating each
 * line independently with rounding leaves the sum a paisa or two off the
 * headline discount, and a customer who is shown "₹200 off" and charged ₹199.98
 * off is right to complain.
 */
export function distributeDiscount(grossByLine: readonly Paise[], totalDiscount: Paise): Paise[] {
  const total = grossByLine.reduce((sum, g) => sum + g, 0);
  if (total === 0 || totalDiscount === 0) return grossByLine.map(() => 0);

  const exact = grossByLine.map((g) => (g * totalDiscount) / total);
  const floors = exact.map(Math.floor);
  let remainder = totalDiscount - floors.reduce((sum, f) => sum + f, 0);

  // Hand the leftover paise to the lines with the largest fractional parts.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  const result = [...floors];
  for (const { index } of order) {
    if (remainder <= 0) break;
    result[index] += 1;
    remainder -= 1;
  }

  return result;
}

export interface TaxSplit {
  /** Pre-tax taxable value. */
  readonly netPaise: Paise;
  readonly taxPaise: Paise;
  readonly grossPaise: Paise;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
}

/**
 * Back out GST from a tax-inclusive price.
 *
 * Indian retail prices are quoted inclusive of GST — the MRP on a namkeen pack
 * is what the customer pays — so the invoice has to derive the taxable value
 * from the gross, not add tax on top. Getting this backwards inflates every
 * order by the tax rate.
 *
 * Rounding is applied to the tax component and the net is taken as the
 * remainder, which guarantees `net + tax === gross` exactly. Deriving both
 * independently lets them disagree by a paisa on roughly half of all values.
 */
export function splitTaxInclusive(
  grossPaise: Paise,
  ratePercent: number,
  treatment: GstTreatment = "INTRA_STATE",
): TaxSplit {
  if (!Number.isInteger(grossPaise)) {
    throw new RangeError(`grossPaise must be an integer, received ${grossPaise}`);
  }
  if (ratePercent < 0) {
    throw new RangeError(`ratePercent must not be negative, received ${ratePercent}`);
  }

  const taxPaise = Math.round((grossPaise * ratePercent) / (100 + ratePercent));
  const netPaise = grossPaise - taxPaise;

  if (treatment === "INTER_STATE") {
    return { netPaise, taxPaise, grossPaise, cgstPaise: 0, sgstPaise: 0, igstPaise: taxPaise };
  }

  // CGST and SGST are each half. Where the total is odd, the extra paisa goes
  // to CGST by convention so the two halves still sum to the total exactly.
  const half = Math.floor(taxPaise / 2);
  return {
    netPaise,
    taxPaise,
    grossPaise,
    cgstPaise: taxPaise - half,
    sgstPaise: half,
    igstPaise: 0,
  };
}

export type DiscountType = "PERCENTAGE" | "FLAT";

/**
 * Apply a discount, clamped so it can never exceed the subtotal.
 *
 * The clamp is not defensive padding: an unclamped percentage over 100, or a
 * flat coupon larger than a small basket, yields a negative order total, and a
 * negative total sent to a payment gateway is at best an error and at worst a
 * refund path someone can drive a coach through.
 */
export function applyDiscount(
  subtotalPaise: Paise,
  type: DiscountType,
  value: number,
): { discountPaise: Paise; totalPaise: Paise } {
  if (value < 0) throw new RangeError(`Discount value must not be negative, received ${value}`);

  const raw =
    type === "PERCENTAGE"
      ? Math.round((subtotalPaise * Math.min(value, 100)) / 100)
      : toPaise(value);

  const discountPaise = Math.min(Math.max(raw, 0), subtotalPaise);
  return { discountPaise, totalPaise: subtotalPaise - discountPaise };
}

export function lineTotal(unitPricePaise: Paise, quantity: number): Paise {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError(`quantity must be a positive integer, received ${quantity}`);
  }
  return unitPricePaise * quantity;
}
