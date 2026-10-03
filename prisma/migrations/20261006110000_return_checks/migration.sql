-- A parcel that comes back (RTO or returned) is checked line by line: back to
-- stock, set aside, or written off. Only a cancellation returned stock
-- before, so sealed returns were lost from the count.

-- CreateEnum
CREATE TYPE "ReturnOutcome" AS ENUM ('RESTOCKED', 'QUARANTINED', 'WRITTEN_OFF');

-- CreateTable
CREATE TABLE "ReturnCheck" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "outcome" "ReturnOutcome" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "decidedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReturnCheck_orderItemId_key" ON "ReturnCheck"("orderItemId");

-- CreateIndex
CREATE INDEX "ReturnCheck_outcome_idx" ON "ReturnCheck"("outcome");

-- AddForeignKey
ALTER TABLE "ReturnCheck" ADD CONSTRAINT "ReturnCheck_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
