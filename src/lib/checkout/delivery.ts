/**
 * Estimated delivery date — build prompt Section 7.2.
 *
 * WHY THIS IS ITS OWN MODULE
 * The shelf-life rule binds at the moment the article reaches the consumer, so
 * the whole compliance check hangs off this one date. It is not a cosmetic
 * "arrives in 3–5 days" badge; it is a compliance input, and it deserves to be
 * derived in one place rather than inlined at the call site.
 *
 * THE BIAS IS DELIBERATE
 * Every estimate here takes the SLOWEST end of the transit range, not the
 * midpoint. The asymmetry matters: estimating optimistically and arriving late
 * means stock that passed the check at checkout is non-compliant on the
 * doorstep, which is the exact failure the rule exists to prevent. Estimating
 * pessimistically only costs you the occasional sale of borderline stock. One
 * of those errors is a regulatory finding and the other is a rounding error on
 * revenue.
 *
 * THESE NUMBERS ARE PLACEHOLDERS
 * Real transit times come from whichever courier is integrated (Shiprocket or
 * equivalent, Phase 2 per Section 7.6). Until then `DEFAULT_DELIVERY_CONFIG` is
 * a conservative guess, and it is exported as config precisely so replacing it
 * is a one-line change rather than a hunt.
 */

export type DeliveryZone = "METRO" | "TIER_2" | "REST_OF_INDIA";

export interface DeliveryConfig {
  /** Working days between order placement and handover to the courier. */
  readonly dispatchLeadDays: number;
  /** Slowest expected transit, in calendar days, per zone. */
  readonly maxTransitDays: Readonly<Record<DeliveryZone, number>>;
  /** Extra days added when the order is placed on a non-working day. */
  readonly weekendBufferDays: number;
}

export const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = {
  dispatchLeadDays: 2,
  // Gujarat-only delivery (see service-area.ts): within-state transit, still
  // taken at the slow end. REST_OF_INDIA is kept for completeness; it isn't
  // served, so no order is quoted against it.
  maxTransitDays: { METRO: 3, TIER_2: 4, REST_OF_INDIA: 9 },
  weekendBufferDays: 1,
};

const MS_PER_DAY = 86_400_000;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Worst-case delivery date for an order placed now.
 *
 * Returned normalised to UTC midnight so it compares cleanly against batch
 * expiry dates, which carry no meaningful time component.
 */
export function estimateDeliveryDate(
  placedAt: Date,
  zone: DeliveryZone,
  config: DeliveryConfig = DEFAULT_DELIVERY_CONFIG,
): Date {
  const buffer = isWeekend(placedAt) ? config.weekendBufferDays : 0;
  const total = config.dispatchLeadDays + config.maxTransitDays[zone] + buffer;
  const estimate = addDays(placedAt, total);

  return new Date(
    Date.UTC(estimate.getUTCFullYear(), estimate.getUTCMonth(), estimate.getUTCDate()),
  );
}

/**
 * Zones within Gujarat, the only area served for now (service-area.ts).
 *
 * Pincode-to-zone mapping is properly a courier's serviceability API, not a
 * hard-coded list — this exists so the quote engine has something to call
 * before that integration lands, and returns the slowest zone for anything it
 * does not recognise rather than guessing fast.
 *
 * METRO: Ahmedabad (380), Gandhinagar and Ahmedabad district (382), Surat
 * (394, 395), Vadodara (390, 391), Rajkot (360). TIER_2: the rest of Gujarat.
 */
const METRO_PREFIXES = ["380", "382", "394", "395", "390", "391", "360"];
const GUJARAT_PREFIXES = ["36", "37", "38", "39"];

export function zoneForPincode(pincode: string): DeliveryZone {
  const pin = pincode.trim();
  if (METRO_PREFIXES.includes(pin.slice(0, 3))) return "METRO";
  if (GUJARAT_PREFIXES.includes(pin.slice(0, 2))) return "TIER_2";
  return "REST_OF_INDIA";
}

/**
 * The zone to estimate with before the shopper's pincode is known: the
 * slowest one actually served, so a promise made on the product page holds
 * anywhere we deliver.
 */
export const SLOWEST_SERVED_ZONE: DeliveryZone = "TIER_2";
