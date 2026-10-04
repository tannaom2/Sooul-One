-- Faster repeat buying: the address book gets names and a last-used date,
-- shoppers can save a Make Your Own Box, and a sold-out product can take
-- "email me when it's back" requests.

-- AlterTable
ALTER TABLE "Address" ADD COLUMN "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lastUsedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Address_customerId_lastUsedAt_idx" ON "Address"("customerId", "lastUsedAt");

-- CreateTable
CREATE TABLE "SavedBox" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "picks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedBox_customerId_idx" ON "SavedBox"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAlert_productId_email_key" ON "StockAlert"("productId", "email");

-- CreateIndex
CREATE INDEX "StockAlert_notifiedAt_productId_idx" ON "StockAlert"("notifiedAt", "productId");

-- AddForeignKey
ALTER TABLE "SavedBox" ADD CONSTRAINT "SavedBox_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedBox" ADD CONSTRAINT "SavedBox_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "Box"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
