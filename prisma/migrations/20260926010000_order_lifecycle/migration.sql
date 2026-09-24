-- Order lifecycle (audit step 4 / triage A1): end states for parcels that come
-- back, and the post-sales facts that can't be reconstructed later.
ALTER TYPE "OrderStatus" ADD VALUE 'RTO';
ALTER TYPE "OrderStatus" ADD VALUE 'RETURNED';

ALTER TABLE "Order" ADD COLUMN "promisedDeliveryDate" TIMESTAMP(3),
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "closeReason" TEXT;
