-- Optional step-up discount for a kit with one more product than the minimum.
-- Additive and nullable: existing bundles are unchanged.
ALTER TABLE "Bundle" ADD COLUMN "stepUpValue" DECIMAL(10,2);
