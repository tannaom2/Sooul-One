-- Suppliers with their FSSAI licences; each product names its manufacturer
-- (and packer or marketer) from them, and each batch its supplier and
-- invoice. FSSAI requires buying only from licensed vendors with records
-- kept, the manufacturer's licence on the listing, and traceability.

-- CreateEnum
CREATE TYPE "FssaiLicenceType" AS ENUM ('CENTRAL', 'STATE', 'REGISTRATION');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "fssaiLicence" TEXT,
    "licenceType" "FssaiLicenceType",
    "licenceExpiresOn" TIMESTAMP(3),
    "gstin" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_licenceExpiresOn_idx" ON "Supplier"("licenceExpiresOn");

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "manufacturerId" TEXT,
ADD COLUMN     "marketerId" TEXT;

-- AlterTable
ALTER TABLE "ProductBatch" ADD COLUMN     "invoiceDate" TIMESTAMP(3),
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "receivedOn" TIMESTAMP(3),
ADD COLUMN     "supplierId" TEXT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_marketerId_fkey" FOREIGN KEY ("marketerId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The manufacturers products already name become suppliers (one per name and
-- address), linked back to their products. Their licence numbers are blank
-- until entered under Suppliers.
INSERT INTO "Supplier" ("id", "name", "address", "createdAt", "updatedAt")
SELECT 'sup_' || md5(m."manufacturerName" || '|' || coalesce(m."manufacturerAddress", '')), m."manufacturerName", coalesce(m."manufacturerAddress", ''), now(), now()
  FROM (SELECT DISTINCT "manufacturerName", "manufacturerAddress" FROM "Product" WHERE "manufacturerName" IS NOT NULL AND "manufacturerName" <> '') m;

UPDATE "Product"
   SET "manufacturerId" = 'sup_' || md5("manufacturerName" || '|' || coalesce("manufacturerAddress", ''))
 WHERE "manufacturerName" IS NOT NULL AND "manufacturerName" <> '';

-- Batches already received: their product's manufacturer is the best record of where they came from.
UPDATE "ProductBatch" b
   SET "supplierId" = p."manufacturerId", "receivedOn" = b."createdAt"
  FROM "Product" p
 WHERE b."productId" = p."id" AND p."manufacturerId" IS NOT NULL;
