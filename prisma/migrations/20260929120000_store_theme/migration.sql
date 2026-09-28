-- CreateEnum
CREATE TYPE "StoreTheme" AS ENUM ('LIGHT', 'DARK');

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "forcedTheme" "StoreTheme" NOT NULL DEFAULT 'LIGHT',
ADD COLUMN     "themeToggleVisible" BOOLEAN NOT NULL DEFAULT true;

