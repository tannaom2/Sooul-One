-- Make Your Own Box (Box, BoxSlot, BoxProduct, CartBox, CartBoxItem; Product.unitCost)
-- and referrals (ReferralProgram, Referral, ReferralEvent, WalletEntry; Order.creditAmount).
-- Additive only: no existing data is changed.

-- CreateEnum
CREATE TYPE "BoxSlotMode" AS ENUM ('ALL', 'CLEARANCE');

-- CreateEnum
CREATE TYPE "BoxProductSource" AS ENUM ('RULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('ATTRIBUTED', 'QUALIFYING', 'HELD', 'REWARDED', 'VOID', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WalletEntryKind" AS ENUM ('REFERRAL_CREDIT', 'ORDER_REDEMPTION', 'REDEMPTION_REFUND', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "CustomerSession" ADD COLUMN     "deviceHash" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "creditAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "creditKind" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "unitCost" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "ReferralCode" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Box" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "size" INTEGER NOT NULL,
    "maxPerProduct" INTEGER NOT NULL DEFAULT 1,
    "allowBelowCost" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "poolRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Box_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoxSlot" (
    "id" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hint" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "minPicks" INTEGER NOT NULL DEFAULT 0,
    "maxPicks" INTEGER,
    "brandIds" TEXT[],
    "categoryIds" TEXT[],
    "minPrice" DECIMAL(10,2),
    "maxPrice" DECIMAL(10,2),
    "mode" "BoxSlotMode" NOT NULL DEFAULT 'ALL',
    "nearExpiryDays" INTEGER,
    "minDaysOfCover" INTEGER,

    CONSTRAINT "BoxSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoxProduct" (
    "id" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "source" "BoxProductSource" NOT NULL DEFAULT 'RULE',
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoxProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartBox" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartBoxItem" (
    "id" TEXT NOT NULL,
    "cartBoxId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CartBoxItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralProgram" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "referrerReward" DECIMAL(10,2) NOT NULL DEFAULT 100,
    "refereeReward" DECIMAL(10,2) NOT NULL DEFAULT 100,
    "minOrderValue" DECIMAL(10,2) NOT NULL DEFAULT 799,
    "maxCreditPerOrder" DECIMAL(10,2) NOT NULL DEFAULT 100,
    "maxRewardsPerReferrer" INTEGER NOT NULL DEFAULT 5,
    "holdDays" INTEGER NOT NULL DEFAULT 7,
    "attributionDays" INTEGER NOT NULL DEFAULT 30,
    "creditExpiryDays" INTEGER NOT NULL DEFAULT 180,
    "refereeDiscountAfterCap" BOOLEAN NOT NULL DEFAULT false,
    "riskThreshold" INTEGER NOT NULL DEFAULT 50,
    "monthlyBudget" DECIMAL(10,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'ATTRIBUTED',
    "via" TEXT NOT NULL,
    "qualifyingOrderId" TEXT,
    "holdUntil" TIMESTAMP(3),
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskSignals" JSONB,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "voidReason" TEXT,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralEvent" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletEntry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "kind" "WalletEntryKind" NOT NULL,
    "referralId" TEXT,
    "orderId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "allocations" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Box_slug_key" ON "Box"("slug");

-- CreateIndex
CREATE INDEX "BoxSlot_boxId_idx" ON "BoxSlot"("boxId");

-- CreateIndex
CREATE INDEX "BoxProduct_slotId_idx" ON "BoxProduct"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "BoxProduct_boxId_productId_key" ON "BoxProduct"("boxId", "productId");

-- CreateIndex
CREATE INDEX "CartBox_cartId_idx" ON "CartBox"("cartId");

-- CreateIndex
CREATE INDEX "CartBoxItem_cartBoxId_idx" ON "CartBoxItem"("cartBoxId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_refereeId_key" ON "Referral"("refereeId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_qualifyingOrderId_key" ON "Referral"("qualifyingOrderId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_attributedAt_idx" ON "Referral"("referrerId", "attributedAt");

-- CreateIndex
CREATE INDEX "Referral_status_holdUntil_idx" ON "Referral"("status", "holdUntil");

-- CreateIndex
CREATE INDEX "ReferralEvent_referralId_createdAt_idx" ON "ReferralEvent"("referralId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletEntry_customerId_createdAt_idx" ON "WalletEntry"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletEntry_kind_referralId_key" ON "WalletEntry"("kind", "referralId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletEntry_kind_orderId_key" ON "WalletEntry"("kind", "orderId");

-- AddForeignKey
ALTER TABLE "BoxSlot" ADD CONSTRAINT "BoxSlot_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "Box"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoxProduct" ADD CONSTRAINT "BoxProduct_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "Box"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoxProduct" ADD CONSTRAINT "BoxProduct_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "BoxSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoxProduct" ADD CONSTRAINT "BoxProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartBox" ADD CONSTRAINT "CartBox_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartBox" ADD CONSTRAINT "CartBox_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "Box"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartBoxItem" ADD CONSTRAINT "CartBoxItem_cartBoxId_fkey" FOREIGN KEY ("cartBoxId") REFERENCES "CartBox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartBoxItem" ADD CONSTRAINT "CartBoxItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "ReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralEvent" ADD CONSTRAINT "ReferralEvent_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
