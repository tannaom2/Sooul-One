-- Admin intelligence: pincode rules, payment attempts, order risk, marketing spend.
-- Additive only: new tables, nullable columns and settings with defaults.

-- CreateEnum
CREATE TYPE "PaymentPreference" AS ENUM ('ONLINE', 'COD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AnalyticsEventType" ADD VALUE 'PINCODE_CHECKED';
ALTER TYPE "AnalyticsEventType" ADD VALUE 'PAYMENT_DISMISSED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "riskReasons" JSONB,
ADD COLUMN     "riskScore" INTEGER;

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "codAutoBlock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "codAutoBlockMinShipped" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "codAutoBlockRtoPercent" INTEGER NOT NULL DEFAULT 35,
ADD COLUMN     "codMaxOrderValue" INTEGER,
ADD COLUMN     "codMinOrderValue" INTEGER,
ADD COLUMN     "preferredPayment" "PaymentPreference" NOT NULL DEFAULT 'ONLINE';

-- CreateTable
CREATE TABLE "PincodeRule" (
    "pincode" TEXT NOT NULL,
    "codBlocked" BOOLEAN NOT NULL DEFAULT false,
    "codAllowed" BOOLEAN NOT NULL DEFAULT false,
    "extraDays" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PincodeRule_pkey" PRIMARY KEY ("pincode")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "method" TEXT,
    "status" TEXT NOT NULL,
    "errorSource" TEXT,
    "errorCode" TEXT,
    "errorReason" TEXT,
    "amountPaise" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentDowntime" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "instrument" JSONB,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "beginAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentDowntime_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentDowntime_status_beginAt_idx" ON "PaymentDowntime"("status", "beginAt");

-- CreateTable
CREATE TABLE "MarketingSpend" (
    "month" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSpend_pkey" PRIMARY KEY ("month")
);

-- CreateIndex
CREATE INDEX "PaymentAttempt_createdAt_idx" ON "PaymentAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_method_createdAt_idx" ON "PaymentAttempt"("method", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_razorpayPaymentId_status_key" ON "PaymentAttempt"("razorpayPaymentId", "status");

-- CreateIndex
CREATE INDEX "Order_postalCode_placedAt_idx" ON "Order"("postalCode", "placedAt");


-- Backfill: the pincode of every existing order, from its shipping address.
UPDATE "Order" SET "postalCode" = "shippingAddress"->>'postalCode'
WHERE "postalCode" IS NULL AND "shippingAddress" ? 'postalCode';

-- Backfill: payment attempts already on order timelines (captures carry the
-- method; failures recorded before this migration don't).
INSERT INTO "PaymentAttempt" ("id", "orderId", "razorpayOrderId", "razorpayPaymentId", "method", "status", "errorReason", "amountPaise", "createdAt")
SELECT 'pa_' || e."id", e."orderId", COALESCE(o."paymentId", ''), e."detail"->>'razorpayPaymentId',
       e."detail"->>'method',
       CASE WHEN e."type" = 'PAYMENT_CAPTURED' THEN 'CAPTURED' ELSE 'FAILED' END,
       e."detail"->>'reason',
       NULLIF(e."detail"->>'amountPaise', '')::int,
       e."createdAt"
FROM "OrderEvent" e JOIN "Order" o ON o."id" = e."orderId"
WHERE e."type" IN ('PAYMENT_CAPTURED', 'PAYMENT_FAILED')
ON CONFLICT DO NOTHING;
