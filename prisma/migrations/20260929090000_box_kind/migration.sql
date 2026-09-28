-- A box is either Box of Gummies or The True Store, never mixed. Additive:
-- existing boxes default to GUMMIES; the demo data is re-sorted separately.

-- CreateEnum
CREATE TYPE "BoxKind" AS ENUM ('GUMMIES', 'TRUE_STORE');

-- AlterTable
ALTER TABLE "Box" ADD COLUMN     "kind" "BoxKind" NOT NULL DEFAULT 'GUMMIES';
