-- Compliance fields (triage A3): label declarations, tax snapshots on order
-- lines, the GST invoice series, the seller's business profile and
-- consent records. All nullable: filled in as the owner's details arrive.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "invoiceDate" TIMESTAMP(3),
ADD COLUMN     "invoiceNumber" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "taxRatePercent" DECIMAL(4,2);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "countryOfOrigin" TEXT,
ADD COLUMN     "ingredients" TEXT,
ADD COLUMN     "manufacturerAddress" TEXT,
ADD COLUMN     "manufacturerName" TEXT,
ADD COLUMN     "mrp" DECIMAL(10,2),
ADD COLUMN     "netQuantity" TEXT,
ADD COLUMN     "packerDetails" TEXT;

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "financialYear" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("financialYear")
);

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "legalName" TEXT,
    "tradeName" TEXT,
    "registeredAddress" TEXT,
    "gstin" TEXT,
    "fssaiLicence" TEXT,
    "customerCarePhone" TEXT,
    "customerCareEmail" TEXT,
    "grievanceOfficerName" TEXT,
    "grievanceOfficerDesignation" TEXT,
    "grievanceOfficerPhone" TEXT,
    "grievanceOfficerEmail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "noticeText" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_email_purpose_createdAt_idx" ON "ConsentRecord"("email", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_invoiceNumber_key" ON "Order"("invoiceNumber");

