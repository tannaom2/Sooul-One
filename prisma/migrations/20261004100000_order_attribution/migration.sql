-- Where each order came from: the first visit and the latest campaign or
-- outside site before it (benchmark gap F6, src/lib/attribution.ts).

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "attribution" JSONB;
