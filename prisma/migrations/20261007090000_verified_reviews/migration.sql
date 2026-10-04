-- A review written from its order (the order page, or the day-14 review
-- request) carries the order, which makes it a "Verified buyer" review. One
-- review per product per order; product-page reviews have no order.

-- AlterTable
ALTER TABLE "Review" ADD COLUMN "orderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Review_orderId_productId_key" ON "Review"("orderId", "productId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
