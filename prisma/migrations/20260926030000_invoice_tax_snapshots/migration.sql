-- GST invoice (triage A3 part 2): each line's taxable value and tax, the
-- delivery charge's tax and the CGST/SGST-or-IGST treatment, as charged.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "gstTreatment" TEXT,
ADD COLUMN     "shippingTaxAmount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "taxAmount" DECIMAL(10,2),
ADD COLUMN     "taxableAmount" DECIMAL(10,2);

