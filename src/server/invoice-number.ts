import "server-only";
import type { db } from "@/lib/db";
import { financialYear, formatInvoiceNumber, sellerSnapshot } from "@/lib/invoice";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * Give an order the next GST invoice number for the current financial year.
 * Called inside the transaction that ships the order, so numbers are unique
 * and consecutive: the counter is bumped in one statement, and if the
 * shipment rolls back so does the bump, leaving no gap in the series.
 *
 * The seller's details are frozen onto the order at the same moment (launch
 * defect D3), read inside the transaction rather than from the cache, so the
 * invoice always shows what was true when it was issued.
 */
export async function issueInvoiceNumber(tx: Tx, orderId: string, at: Date = new Date()): Promise<string> {
  const fy = financialYear(at);
  const [row] = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "InvoiceSequence" ("financialYear", "lastNumber") VALUES (${fy}, 1)
    ON CONFLICT ("financialYear") DO UPDATE SET "lastNumber" = "InvoiceSequence"."lastNumber" + 1
    RETURNING "lastNumber"`;
  const invoiceNumber = formatInvoiceNumber(fy, row.lastNumber);
  const profile = await tx.businessProfile.findUnique({ where: { id: "default" } });
  const seller = sellerSnapshot({ ...profile, fssaiLicence: profile?.fssaiLicence ?? process.env.NEXT_PUBLIC_FSSAI_LICENCE_NUMBER ?? null });
  await tx.order.update({ where: { id: orderId }, data: { invoiceNumber, invoiceDate: at, sellerSnapshot: seller } });
  return invoiceNumber;
}
