-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('VISIT', 'PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT_STARTED', 'ORDER_PLACED', 'ORDER_PAID');

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "AnalyticsEventType" NOT NULL,
    "productId" TEXT,
    "orderId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "AnalyticsEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_sessionId_type_idx" ON "AnalyticsEvent"("sessionId", "type");
