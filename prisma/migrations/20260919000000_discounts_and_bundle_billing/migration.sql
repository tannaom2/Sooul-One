-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "discountActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "discountPercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "productDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "bundleDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "bundleLabel" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "listUnitPriceSnapshot" DECIMAL(10,2);
