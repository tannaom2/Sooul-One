-- The owner's daily summary email can be switched off from the Messages page.

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN "dailyDigest" BOOLEAN NOT NULL DEFAULT true;
