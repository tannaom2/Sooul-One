-- Refill reminders (benchmark gap R2): how many servings a day each
-- supplement takes, and which orders asked for a reminder.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "servingsPerDay" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "refillOptInAt" TIMESTAMP(3);

-- Taken from the dosage line the products already carry ("chew 2 gummies
-- daily"). Anything it can't read stays blank for the owner to fill in.
UPDATE "Product"
   SET "servingsPerDay" = substring(lower("dosageGuidance") from 'chew ([0-9]+) gumm')::int
 WHERE "regulatoryType" = 'HEALTH_SUPPLEMENT'
   AND lower("dosageGuidance") ~ 'chew [0-9]+ gumm[a-z]* (daily|each|a day|every|per day|after|with|before|30)';
UPDATE "Product" SET "servingsPerDay" = 1
 WHERE "regulatoryType" = 'HEALTH_SUPPLEMENT' AND "servingsPerDay" IS NULL AND lower("dosageGuidance") ~ 'chew (one|a single) gummy';
UPDATE "Product" SET "servingsPerDay" = 2
 WHERE "regulatoryType" = 'HEALTH_SUPPLEMENT' AND "servingsPerDay" IS NULL AND lower("dosageGuidance") ~ 'chew two gummies';
