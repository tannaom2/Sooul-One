-- One order per checkout attempt: the browser sends an Idempotency-Key, stored
-- here, so a double click or retry returns the first order. Additive only.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
