-- Store controls (triage step 6): owner kill switches for orders, cash on
-- delivery and bundle offers.
-- CreateTable
CREATE TABLE "StoreSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "ordersPaused" BOOLEAN NOT NULL DEFAULT false,
    "pauseMessage" TEXT,
    "codEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bundlesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSettings_pkey" PRIMARY KEY ("id")
);

