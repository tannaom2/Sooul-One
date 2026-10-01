-- An issued GST invoice must never change (launch defect D3). Invoices used
-- to render the current Business details, so editing the address or GSTIN
-- rewrote every invoice already issued. Each order now keeps the seller's
-- details as they stood when its invoice number was issued.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "sellerSnapshot" JSONB;

-- Invoices issued before this change: the current details are the best
-- record of what they showed.
UPDATE "Order" o
   SET "sellerSnapshot" = jsonb_build_object(
         'legalName', bp."legalName",
         'tradeName', bp."tradeName",
         'registeredAddress', bp."registeredAddress",
         'gstin', bp."gstin",
         'fssaiLicence', bp."fssaiLicence",
         'customerCareEmail', bp."customerCareEmail",
         'customerCarePhone', bp."customerCarePhone")
  FROM "BusinessProfile" bp
 WHERE bp.id = 'default' AND o."invoiceNumber" IS NOT NULL AND o."sellerSnapshot" IS NULL;
