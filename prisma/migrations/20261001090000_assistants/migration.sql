-- Storefront assistant and the owner's local AI copilot. Additive only.

-- AlterEnum
ALTER TYPE "AnalyticsEventType" ADD VALUE 'ASSISTANT_INTENT';

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "assistantEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "returnWindowDays" INTEGER,
ADD COLUMN     "returnConditions" TEXT,
ADD COLUMN     "supportWhatsapp" TEXT,
ADD COLUMN     "copilotUrl" TEXT,
ADD COLUMN     "copilotToken" TEXT;
