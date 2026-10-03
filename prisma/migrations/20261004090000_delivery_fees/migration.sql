-- Delivery fees set from Store controls instead of code (benchmark gap M6).
-- The defaults are the amounts checkout charged until now.

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "deliveryFee" INTEGER NOT NULL DEFAULT 59,
ADD COLUMN     "freeDeliveryAbove" INTEGER NOT NULL DEFAULT 799;
