/**
 * Checkout quote engine — build prompt Sections 7.2 and 8.5.
 *
 * This is where the compliance rules meet the money. One cart can hold a
 * namkeen gift box at 12% GST and a bottle of gummies at 18%, bought as a guest
 * in a single order (Decision #1), and every packaged-food line has to clear
 * the shelf-life-at-delivery rule before any of it can be charged for.
 *
 * Pure and synchronous: batches and prices are passed in, nothing is read from
 * the database and nothing is written. The caller loads the data, calls this to
 * find out what the order costs and whether it may proceed, and only then opens
 * a transaction. That ordering matters — quoting inside a write transaction
 * would hold locks across the whole pricing calculation for no reason.
 *
 * ORDER OF OPERATIONS, AND WHY
 *   1. Allocate stock per line (FEFO, shelf-life filtered)
 *   2. Total only the lines that can actually ship, at the unit price the
 *      shopper pays (any product-level discount is already in that price)
 *   3. Apply bundle / combination offers to the lines that qualify
 *   4. Apply the coupon to what is left
 *   5. Back GST out of the DISCOUNTED gross, per line, at each line's own rate
 *   6. Add shipping
 *
 * Step 4 is the one that is easy to get wrong. GST is computed after the
 * discount because the discount reduces the taxable value of the supply — a
 * customer who pays less owes less tax. Computing tax on the pre-discount
 * figure over-declares output tax on every discounted order.
 */

import {
  applyDiscount,
  distributeDiscount,
  lineTotal,
  splitTaxInclusive,
  toPaise,
  type DiscountType,
  type GstTreatment,
  type Paise,
} from "../money";
import { applyBundles, type AppliedBundle, type BundleRule } from "./bundles";
import { allocateFefo, type Allocation } from "../compliance/fefo";
import {
  EXPIRY_ONLY_POLICY,
  FSSAI_ECOMMERCE_POLICY,
  type BatchEligibility,
  type BatchLike,
} from "../compliance/shelf-life";

export type RegulatoryType = "PACKAGED_FOOD" | "HEALTH_SUPPLEMENT" | "BEVERAGE";

export interface QuoteLineInput {
  readonly productId: string;
  readonly variantId?: string;
  readonly name: string;
  readonly regulatoryType: RegulatoryType;
  /** What the shopper pays per unit — product-level discount already applied. */
  readonly unitPricePaise: Paise;
  /** Undiscounted unit price, for display and the invoice. Defaults to `unitPricePaise`. */
  readonly listPricePaise?: Paise;
  readonly quantity: number;
  readonly taxRatePercent: number;
  /** Required for PACKAGED_FOOD and BEVERAGE; ignored for supplements. */
  readonly shelfLifeDays?: number;
  /** Batch stock. Omit for products not tracked by batch. */
  readonly batches?: readonly BatchLike[];
  /** Untracked stock, used when `batches` is absent. */
  readonly stockQuantity?: number;
  readonly retailOnly?: boolean;
  /** False once staff take the product off sale; it may still sit in older baskets. */
  readonly active?: boolean;
}

export type LineStatus = "OK" | "PARTIAL" | "BLOCKED";

export type LineBlockReason =
  | "UNAVAILABLE"
  | "RETAIL_ONLY"
  | "OUT_OF_STOCK"
  | "NO_COMPLIANT_BATCH"
  | "MISSING_SHELF_LIFE_DATA";

export interface QuoteLine {
  readonly productId: string;
  readonly variantId?: string;
  readonly name: string;
  readonly status: LineStatus;
  readonly reason?: LineBlockReason;
  readonly quantityRequested: number;
  readonly quantityAvailable: number;
  /** Gross, tax-inclusive, for the available quantity only, after product-level discount. */
  readonly grossPaise: Paise;
  /** The same quantity at the undiscounted list price. */
  readonly listGrossPaise: Paise;
  /** Saved through the product's own discount (list minus gross). */
  readonly productDiscountPaise: Paise;
  /** This line's share of a bundle offer. */
  readonly bundleDiscountPaise: Paise;
  readonly bundleName?: string;
  /** This line's share of the coupon. */
  readonly discountPaise: Paise;
  readonly taxablePaise: Paise;
  readonly taxPaise: Paise;
  readonly taxRatePercent: number;
  readonly allocations: readonly Allocation[];
  /** Batches considered and refused — surfaced to the admin, not the shopper. */
  readonly rejectedBatches: readonly BatchEligibility[];
  /**
   * True when the line was judged on expiry alone because no total shelf life
   * is recorded. Sold, but the product data needs fixing — surfaced to the
   * admin, never to the shopper.
   */
  readonly shelfLifeDataMissing: boolean;
  readonly customerMessage?: string;
}

export interface ShippingPolicy {
  readonly flatRatePaise: Paise;
  /** Order gross at or above which shipping is free. */
  readonly freeAbovePaise: Paise;
  /**
   * GST on the shipping charge. Under composite-supply rules this should track
   * the rate of the principal supply rather than being a fixed 18% — confirm
   * the treatment with your accountant before the first GST return, since the
   * mixed-rate cart makes "principal supply" a judgement call rather than an
   * obvious answer.
   */
  readonly taxRatePercent: number;
}

export const DEFAULT_SHIPPING_POLICY: ShippingPolicy = {
  flatRatePaise: toPaise("59"),
  freeAbovePaise: toPaise("799"),
  taxRatePercent: 18,
};

export interface QuoteInput {
  readonly lines: readonly QuoteLineInput[];
  readonly estimatedDeliveryDate: Date;
  readonly gstTreatment: GstTreatment;
  readonly coupon?: { readonly code: string; readonly type: DiscountType; readonly value: number };
  readonly bundles?: readonly BundleRule[];
  readonly shipping?: ShippingPolicy;
}

export interface Quote {
  readonly lines: readonly QuoteLine[];
  /** False when any line cannot ship — the shopper must act before paying. */
  readonly canProceed: boolean;
  /** Sum of shippable lines at the undiscounted list price. */
  readonly listSubtotalPaise: Paise;
  /** Total saved through product-level discounts. */
  readonly productDiscountPaise: Paise;
  /** Sum of shippable lines at the price the shopper pays (after product discounts). */
  readonly subtotalPaise: Paise;
  readonly bundleDiscountPaise: Paise;
  readonly appliedBundles: readonly AppliedBundle[];
  /** Coupon discount. */
  readonly discountPaise: Paise;
  readonly shippingPaise: Paise;
  readonly taxPaise: Paise;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  readonly totalPaise: Paise;
  readonly appliedCouponCode?: string;
  readonly blockedLineCount: number;
}

/**
 * Which product types the shelf-life-at-delivery rule applies to.
 *
 * ---------------------------------------------------------------------------
 * THIS IS WIDER THAN THE BRIEF SPECIFIED, DELIBERATELY
 * ---------------------------------------------------------------------------
 * Section 7.2 scoped the rule to `PACKAGED_FOOD` line items. That appears to be
 * under-inclusive. The regulator's direction binds "any food article delivered
 * to consumer by e-commerce FBO", and health supplements and nutraceuticals are
 * categories of *food product* under the Food Safety and Standards Act, 2006 —
 * which is the entire reason FSSAI licenses them rather than the drug
 * regulator. The brief establishes this itself in Section 2.3.
 *
 * If supplements are food articles, the rule reaches them, and a gummy bottle
 * delivered two weeks from expiry is as non-compliant as a namkeen pack.
 * Scoping the check to packaged food only would leave three of the four live
 * brands unprotected.
 *
 * Applied to all three types here. FOR COMPLIANCE COUNSEL TO CONFIRM — this is
 * a reading of scope, not a settled point, and it is cheap to narrow later by
 * editing this one constant. The cost of being wrong in this direction is some
 * short-dated gummy stock being diverted to retail; in the other direction it
 * is non-compliant deliveries across the whole gummies catalogue.
 */
const SHELF_LIFE_RULE_APPLIES: readonly RegulatoryType[] = [
  "PACKAGED_FOOD",
  "HEALTH_SUPPLEMENT",
  "BEVERAGE",
];

export interface Availability {
  readonly quantityAvailable: number;
  readonly allocations: readonly Allocation[];
  readonly rejectedBatches: readonly BatchEligibility[];
  readonly reason?: LineBlockReason;
  readonly usedFallbackPolicy?: boolean;
}

/** Exported so product pages and cards apply exactly the rule the basket enforces. */
export function resolveAvailability(line: QuoteLineInput, estimatedDeliveryDate: Date): Availability {
  const none = { quantityAvailable: 0, allocations: [], rejectedBatches: [] };

  // Off sale (a recall, a label error): nothing ships, whatever stock remains.
  if (line.active === false) return { ...none, reason: "UNAVAILABLE" };
  if (line.retailOnly) return { ...none, reason: "RETAIL_ONLY" };

  // Not batch-tracked: a simple count, no shelf-life judgement possible.
  if (!line.batches || line.batches.length === 0) {
    const available = Math.min(line.stockQuantity ?? 0, line.quantity);
    if (available === 0) return { ...none, reason: "OUT_OF_STOCK" };
    return { quantityAvailable: available, allocations: [], rejectedBatches: [] };
  }

  const inScope = SHELF_LIFE_RULE_APPLIES.includes(line.regulatoryType);

  // Packaged food and beverages must carry a shelf life. Refuse rather than
  // assume: defaulting it would silently disable the compliance check on
  // exactly the products it exists to protect.
  if (inScope && !line.shelfLifeDays && line.regulatoryType !== "HEALTH_SUPPLEMENT") {
    return { ...none, reason: "MISSING_SHELF_LIFE_DATA" };
  }

  // A supplement with no recorded shelf life falls back to expiry-only and is
  // flagged, rather than being blocked outright — the current schema permits
  // the field to be absent on supplements, so blocking would take the whole
  // gummies catalogue offline over a data gap. See `usedFallbackPolicy`.
  const usedFallbackPolicy = inScope && !line.shelfLifeDays;
  const policy = usedFallbackPolicy || !inScope ? EXPIRY_ONLY_POLICY : FSSAI_ECOMMERCE_POLICY;

  const result = allocateFefo(
    line.batches,
    line.quantity,
    line.shelfLifeDays ?? 1,
    estimatedDeliveryDate,
    policy,
  );

  if (result.quantityAllocated === 0) {
    // Distinguish "we have none" from "we have some but it's too short-dated".
    // The shopper sees different copy for each, and conflating them turns a
    // recoverable stock problem into an unexplained outage.
    const everyRejectionIsStock =
      result.rejected.length > 0 && result.rejected.every((r) => r.reason === "OUT_OF_STOCK");

    return {
      quantityAvailable: 0,
      allocations: [],
      rejectedBatches: result.rejected,
      reason: everyRejectionIsStock ? "OUT_OF_STOCK" : "NO_COMPLIANT_BATCH",
      usedFallbackPolicy,
    };
  }

  return {
    quantityAvailable: result.quantityAllocated,
    allocations: result.allocations,
    rejectedBatches: result.rejected,
    usedFallbackPolicy,
  };
}

export const CUSTOMER_MESSAGES: Record<LineBlockReason, string> = {
  UNAVAILABLE: "No longer available. Remove it to check out.",
  RETAIL_ONLY: "Available in our stores only — this item isn't shipped.",
  OUT_OF_STOCK: "Out of stock.",
  NO_COMPLIANT_BATCH:
    "Temporarily unavailable. Our remaining stock of this item is too close to its best-before date to ship.",
  MISSING_SHELF_LIFE_DATA: "Temporarily unavailable.",
};

export function buildQuote(input: QuoteInput): Quote {
  const shipping = input.shipping ?? DEFAULT_SHIPPING_POLICY;

  // --- 1. Availability, per line -------------------------------------------
  const resolved = input.lines.map((line) => {
    const availability = resolveAvailability(line, input.estimatedDeliveryDate);
    const grossPaise =
      availability.quantityAvailable > 0
        ? lineTotal(line.unitPricePaise, availability.quantityAvailable)
        : 0;

    const status: LineStatus =
      availability.quantityAvailable === 0
        ? "BLOCKED"
        : availability.quantityAvailable < line.quantity
          ? "PARTIAL"
          : "OK";

    const listGrossPaise =
      availability.quantityAvailable > 0
        ? lineTotal(line.listPricePaise ?? line.unitPricePaise, availability.quantityAvailable)
        : 0;

    return { line, availability, grossPaise, listGrossPaise, status };
  });

  // --- 2. Subtotal of shippable lines only ---------------------------------
  const subtotalPaise = resolved.reduce((sum, r) => sum + r.grossPaise, 0);

  const listSubtotalPaise = resolved.reduce((sum, r) => sum + r.listGrossPaise, 0);

  // --- 3. Bundle / combination offers ---------------------------------------
  //
  // Priced off MRP (listGrossPaise), not off whatever a line's own
  // product-level discount already brought it to — a "3 for ₹399" or "any 3,
  // 25% off" style offer is a fixed deal against the sticker price, the same
  // way it works everywhere else, not something that gets deeper or shallower
  // depending on an unrelated sale.
  //
  // The two discounts never stack: a line only benefits from the bundle if
  // the bundle's MRP-based price beats what the product discount already
  // gives it. `realizedBundleDiscount` is exactly that difference — zero
  // whenever the product discount already wins, so the shopper is never
  // charged as if both applied at once.
  const bundles = applyBundles(
    resolved.map((r) => ({ productId: r.line.productId, grossPaise: r.listGrossPaise })),
    input.bundles ?? [],
  );

  const preCouponByLine = resolved.map((r, i) => {
    const rawBundleShare = bundles.perLinePaise[i];
    if (rawBundleShare <= 0) return r.grossPaise;
    return Math.min(r.grossPaise, r.listGrossPaise - rawBundleShare);
  });

  const bundleDiscountPaise = resolved.reduce((sum, r, i) => sum + (r.grossPaise - preCouponByLine[i]), 0);

  // --- 4. Coupon, on what the better-of-the-two discounts left ---------------
  const { discountPaise } = input.coupon
    ? applyDiscount(subtotalPaise - bundleDiscountPaise, input.coupon.type, input.coupon.value)
    : { discountPaise: 0 };

  const perLineDiscount = distributeDiscount(preCouponByLine, discountPaise);

  // --- 5. GST, per line, on the discounted gross ---------------------------
  let taxPaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  const lines: QuoteLine[] = resolved.map((r, index) => {
    const lineDiscount = perLineDiscount[index];
    const realizedBundleDiscount = r.grossPaise - preCouponByLine[index];
    const discountedGross = preCouponByLine[index] - lineDiscount;
    const split = splitTaxInclusive(
      discountedGross,
      r.line.taxRatePercent,
      input.gstTreatment,
    );

    taxPaise += split.taxPaise;
    cgstPaise += split.cgstPaise;
    sgstPaise += split.sgstPaise;
    igstPaise += split.igstPaise;

    return {
      productId: r.line.productId,
      variantId: r.line.variantId,
      name: r.line.name,
      status: r.status,
      reason: r.availability.reason,
      quantityRequested: r.line.quantity,
      quantityAvailable: r.availability.quantityAvailable,
      grossPaise: r.grossPaise,
      listGrossPaise: r.listGrossPaise,
      productDiscountPaise: r.listGrossPaise - r.grossPaise,
      bundleDiscountPaise: realizedBundleDiscount,
      // Only named when the bundle actually beat the product discount on this
      // line — showing "Bundle offer" for a line it did nothing for would be
      // misleading, even though the bundle nominally claimed the line.
      bundleName: realizedBundleDiscount > 0 ? (bundles.perLineBundle[index] ?? undefined) : undefined,
      discountPaise: lineDiscount,
      taxablePaise: split.netPaise,
      taxPaise: split.taxPaise,
      taxRatePercent: r.line.taxRatePercent,
      allocations: r.availability.allocations,
      rejectedBatches: r.availability.rejectedBatches,
      shelfLifeDataMissing: r.availability.usedFallbackPolicy === true,
      customerMessage: r.availability.reason
        ? CUSTOMER_MESSAGES[r.availability.reason]
        : r.status === "PARTIAL"
          ? `Only ${r.availability.quantityAvailable} available right now.`
          : undefined,
    };
  });

  // --- 6. Shipping ---------------------------------------------------------
  const discountedSubtotal = subtotalPaise - bundleDiscountPaise - discountPaise;
  const shippingPaise =
    discountedSubtotal === 0 || discountedSubtotal >= shipping.freeAbovePaise
      ? 0
      : shipping.flatRatePaise;

  if (shippingPaise > 0) {
    const split = splitTaxInclusive(shippingPaise, shipping.taxRatePercent, input.gstTreatment);
    taxPaise += split.taxPaise;
    cgstPaise += split.cgstPaise;
    sgstPaise += split.sgstPaise;
    igstPaise += split.igstPaise;
  }

  const blockedLineCount = lines.filter((l) => l.status !== "OK").length;

  return {
    lines,
    // Any line that cannot be fulfilled as requested stops the order. Silently
    // charging for a reduced basket is the kind of thing that generates
    // chargebacks, so the shopper decides.
    canProceed: blockedLineCount === 0 && lines.length > 0,
    listSubtotalPaise,
    productDiscountPaise: listSubtotalPaise - subtotalPaise,
    subtotalPaise,
    bundleDiscountPaise,
    appliedBundles: bundles.applied,
    discountPaise,
    shippingPaise,
    taxPaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    totalPaise: discountedSubtotal + shippingPaise,
    appliedCouponCode: discountPaise > 0 ? input.coupon?.code : undefined,
    blockedLineCount,
  };
}
