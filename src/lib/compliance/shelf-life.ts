/**
 * FSSAI shelf-life-at-delivery rule — build prompt Sections 2.3 and 7.2.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * The regulator's direction reads: "Any food article delivered to consumer by
 * e-commerce FBO shall have shelf life of 30 percent or 45 days before expiry
 * at the time of delivery to the consumer."
 *
 * The build prompt flagged the "or" as needing resolution before it was
 * encoded as a hard business rule, and it was right to: the sentence reads
 * three different ways, and two of them are wrong.
 *
 *   min(30%, 45)  — fails the regulator's own worked example for a 3-month
 *                   product, where the operative figure is 45 days, not 27.
 *   max(30%, 45)  — fails the regulator's worked example for a 10-day product
 *                   (butter), which requires 3 days remaining, not an
 *                   impossible 45.
 *
 * The only reading consistent with BOTH published examples is: the 30%
 * proportion governs, with 45 days acting as a floor that is applied only when
 * the product's total shelf life is long enough for that floor to be
 * meaningful.
 *
 *   10-day shelf life  -> 30% = 3 days    (floor unreachable, percentage governs)
 *   90-day shelf life  -> 30% = 27 days   -> floor lifts it to 45 days
 *   180-day shelf life -> 30% = 54 days   -> exceeds the floor, 54 governs
 *
 * ---------------------------------------------------------------------------
 * WHAT STILL NEEDS A HUMAN
 * ---------------------------------------------------------------------------
 * This implementation is the strictest reading that both published examples
 * support, which is the right default for a compliance rule. But the
 * thresholds are exported as configuration rather than hard-coded inline,
 * because the underlying wording is genuinely ambiguous and confirming it is a
 * question for SooulOne's compliance counsel, not a question this code can
 * settle. See `ShelfLifePolicy` and Section 14 of the build prompt.
 *
 * Note the discontinuity this creates, which `assessShippability` surfaces:
 * for a product whose total shelf life is at or just above the 45-day floor,
 * the shippable window collapses toward zero. That is a real property of the
 * rule as written, not a bug here — and it is precisely the situation the
 * `Product.retailOnly` flag exists to handle.
 */

/** Tunable thresholds. Defaults are the current FSSAI figures. */
export interface ShelfLifePolicy {
  /** Proportion of total shelf life that must remain at delivery. */
  readonly minimumProportionRemaining: number;
  /** Absolute day floor, applied only when total shelf life can accommodate it. */
  readonly minimumDaysFloor: number;
}

export const FSSAI_ECOMMERCE_POLICY: ShelfLifePolicy = {
  minimumProportionRemaining: 0.3,
  minimumDaysFloor: 45,
};

/**
 * Expiry-only: a batch is acceptable until the day it expires, with no
 * proportional margin.
 *
 * This is NOT a lighter version of the rule to reach for when the real one is
 * inconvenient. It exists for the single case where a product has no recorded
 * total shelf life, so no proportion can be computed — and in that case the
 * right answer is to fix the product data, not to ship on this policy
 * indefinitely. The quote engine flags every line that falls back to it.
 */
export const EXPIRY_ONLY_POLICY: ShelfLifePolicy = {
  minimumProportionRemaining: 0,
  minimumDaysFloor: 0,
};

const MS_PER_DAY = 86_400_000;

/**
 * Whole days between two instants, normalised to UTC midnight.
 *
 * Deliberately not a naive `(b - a) / MS_PER_DAY`: order timestamps carry a
 * time-of-day component, and an order placed at 23:50 must not be judged
 * against a different day boundary than one placed at 00:10.
 */
export function wholeDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * Days of shelf life that must remain at the moment of delivery.
 *
 * Rounds up: when the rule lands between two days, the stricter day is the
 * compliant one.
 */
export function requiredRemainingDays(
  totalShelfLifeDays: number,
  policy: ShelfLifePolicy = FSSAI_ECOMMERCE_POLICY,
): number {
  if (!Number.isFinite(totalShelfLifeDays) || totalShelfLifeDays <= 0) {
    throw new RangeError(
      `totalShelfLifeDays must be a positive number, received ${totalShelfLifeDays}`,
    );
  }

  const proportional = Math.ceil(totalShelfLifeDays * policy.minimumProportionRemaining);

  // The floor only applies where the product could ever satisfy it. Below that,
  // the proportional figure governs — see the butter example above.
  if (totalShelfLifeDays < policy.minimumDaysFloor) return proportional;

  return Math.max(proportional, policy.minimumDaysFloor);
}

export interface ShippabilityAssessment {
  /** False when no batch of this SKU could ever satisfy the rule. */
  readonly isShippable: boolean;
  readonly requiredRemainingDays: number;
  /** Days after manufacture during which a batch may still be delivered. */
  readonly shippableWindowDays: number;
  readonly warning?: string;
}

/**
 * Whether a SKU's shelf life permits online sale at all.
 *
 * Surfaced in the admin product form so the owner learns a SKU is structurally
 * un-shippable at data-entry time, rather than discovering it as a wave of
 * blocked checkouts. The remedy is `retailOnly = true`, not a rule override.
 */
export function assessShippability(
  totalShelfLifeDays: number,
  policy: ShelfLifePolicy = FSSAI_ECOMMERCE_POLICY,
): ShippabilityAssessment {
  const required = requiredRemainingDays(totalShelfLifeDays, policy);
  const window = totalShelfLifeDays - required;

  if (window <= 0) {
    return {
      isShippable: false,
      requiredRemainingDays: required,
      shippableWindowDays: 0,
      warning:
        `A ${totalShelfLifeDays}-day shelf life requires ${required} days remaining at ` +
        `delivery, leaving no window in which this SKU can lawfully be shipped. ` +
        `Mark it retailOnly, or confirm the shelf life figure is correct.`,
    };
  }

  if (window <= 7) {
    return {
      isShippable: true,
      requiredRemainingDays: required,
      shippableWindowDays: window,
      warning:
        `Only ${window} day(s) after manufacture in which this SKU can be dispatched ` +
        `and still meet the delivery rule. Expect frequent checkout blocks.`,
    };
  }

  return {
    isShippable: true,
    requiredRemainingDays: required,
    shippableWindowDays: window,
  };
}

export interface BatchLike {
  readonly id: string;
  readonly batchNumber: string;
  readonly expiresOn: Date;
  readonly quantityRemaining: number;
}

export type IneligibilityReason = "EXPIRED" | "INSUFFICIENT_REMAINING_SHELF_LIFE" | "OUT_OF_STOCK";

export interface BatchEligibility {
  readonly batchId: string;
  readonly batchNumber: string;
  readonly isEligible: boolean;
  readonly daysRemainingAtDelivery: number;
  readonly requiredRemainingDays: number;
  readonly reason?: IneligibilityReason;
}

/**
 * Judge one batch against the rule, as at the estimated delivery date.
 *
 * Evaluated against estimated delivery, not order placement: the regulation
 * binds at the moment the article reaches the consumer, so a batch that is
 * compliant when the order is placed and non-compliant four days later when it
 * arrives is a violation, and checking at placement time would miss it.
 */
export function evaluateBatchForDelivery(
  batch: BatchLike,
  totalShelfLifeDays: number,
  estimatedDeliveryDate: Date,
  policy: ShelfLifePolicy = FSSAI_ECOMMERCE_POLICY,
): BatchEligibility {
  const required = requiredRemainingDays(totalShelfLifeDays, policy);
  const daysRemaining = wholeDaysBetween(estimatedDeliveryDate, batch.expiresOn);

  const base = {
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    daysRemainingAtDelivery: daysRemaining,
    requiredRemainingDays: required,
  };

  if (batch.quantityRemaining <= 0) {
    return { ...base, isEligible: false, reason: "OUT_OF_STOCK" };
  }
  if (daysRemaining <= 0) {
    return { ...base, isEligible: false, reason: "EXPIRED" };
  }
  if (daysRemaining < required) {
    return { ...base, isEligible: false, reason: "INSUFFICIENT_REMAINING_SHELF_LIFE" };
  }

  return { ...base, isEligible: true };
}
