-- AlterEnum
ALTER TYPE "AdminRole" ADD VALUE 'MANAGER';
ALTER TYPE "AdminRole" ADD VALUE 'FULFILMENT';
ALTER TYPE "AdminRole" ADD VALUE 'CONTENT';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "accessToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_accessToken_key" ON "Order"("accessToken");
