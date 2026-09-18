/**
 * FEFO (First-Expired-First-Out) batch allocation — build prompt Section 7.2.
 *
 * WHY FEFO RATHER THAN FIFO
 * Received-order and expiry-order diverge whenever a supplier ships a shorter-
 * dated lot after a longer-dated one, which is routine. Picking by receipt date
 * would leave the short-dated lot ageing on the shelf until it breaches the
 * delivery rule and has to be written off. Picking by expiry date clears the
 * most perishable stock first, which is both the lower-waste and the more
 * compliant behaviour.
 *
 * This allocator is pure and takes batches as an argument rather than reading
 * the database, so the checkout path, the admin near-expiry report and the
 * tests all exercise identical logic.
 */

import {
  evaluateBatchForDelivery,
  FSSAI_ECOMMERCE_POLICY,
  type BatchEligibility,
  type BatchLike,
  type ShelfLifePolicy,
} from "./shelf-life";

export interface Allocation {
  readonly batchId: string;
  readonly batchNumber: string;
  readonly quantity: number;
  readonly expiresOn: Date;
}

export interface AllocationResult {
  /** True only when the full requested quantity was allocated. */
  readonly fulfilled: boolean;
  readonly allocations: readonly Allocation[];
  readonly quantityAllocated: number;
  readonly quantityShort: number;
  /** Every batch considered, eligible or not — drives the admin explanation. */
  readonly rejected: readonly BatchEligibility[];
}

/**
 * Allocate `quantity` units across batches, earliest-expiring eligible first.
 *
 * Partial allocation is reported rather than thrown: the checkout layer decides
 * whether to block the line, offer a substitute or split the shipment, and that
 * is a merchandising decision this function should not make on its behalf.
 */
export function allocateFefo(
  batches: readonly BatchLike[],
  quantity: number,
  totalShelfLifeDays: number,
  estimatedDeliveryDate: Date,
  policy: ShelfLifePolicy = FSSAI_ECOMMERCE_POLICY,
): AllocationResult {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError(`quantity must be a positive integer, received ${quantity}`);
  }

  // Sort a copy — callers pass arrays straight from Prisma and must not have
  // them mutated underneath.
  const ordered = [...batches].sort((a, b) => {
    const byExpiry = a.expiresOn.getTime() - b.expiresOn.getTime();
    // Tie-break on batch number so allocation is deterministic and therefore
    // reproducible in tests and in an audit.
    return byExpiry !== 0 ? byExpiry : a.batchNumber.localeCompare(b.batchNumber);
  });

  const allocations: Allocation[] = [];
  const rejected: BatchEligibility[] = [];
  let outstanding = quantity;

  for (const batch of ordered) {
    const verdict = evaluateBatchForDelivery(
      batch,
      totalShelfLifeDays,
      estimatedDeliveryDate,
      policy,
    );

    if (!verdict.isEligible) {
      rejected.push(verdict);
      continue;
    }
    if (outstanding === 0) break;

    const take = Math.min(outstanding, batch.quantityRemaining);
    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      quantity: take,
      expiresOn: batch.expiresOn,
    });
    outstanding -= take;
  }

  return {
    fulfilled: outstanding === 0,
    allocations,
    quantityAllocated: quantity - outstanding,
    quantityShort: outstanding,
    rejected,
  };
}

export interface NearExpiryBatch {
  readonly batchId: string;
  readonly batchNumber: string;
  readonly quantityRemaining: number;
  readonly daysUntilUnsellable: number;
}

/**
 * Batches approaching the point where they can no longer lawfully be shipped.
 *
 * Note this is NOT "approaching expiry". A batch stops being sellable online
 * the moment it drops below the required remaining shelf life, which for a
 * long-dated product is many weeks before the printed expiry date. Alerting on
 * expiry would reliably fire too late to act on — which is exactly the
 * operational failure the separate near-expiry alert in Section 7.6 exists to
 * prevent.
 */
export function findNearExpiryBatches(
  batches: readonly BatchLike[],
  totalShelfLifeDays: number,
  asOf: Date,
  warningWindowDays = 14,
  policy: ShelfLifePolicy = FSSAI_ECOMMERCE_POLICY,
): NearExpiryBatch[] {
  const results: NearExpiryBatch[] = [];

  for (const batch of batches) {
    if (batch.quantityRemaining <= 0) continue;

    const verdict = evaluateBatchForDelivery(batch, totalShelfLifeDays, asOf, policy);
    const daysUntilUnsellable =
      verdict.daysRemainingAtDelivery - verdict.requiredRemainingDays;

    if (daysUntilUnsellable <= warningWindowDays) {
      results.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        quantityRemaining: batch.quantityRemaining,
        daysUntilUnsellable,
      });
    }
  }

  return results.sort((a, b) => a.daysUntilUnsellable - b.daysUntilUnsellable);
}
