import "server-only";
import type { db } from "@/lib/db";
import { financialYear, formatInvoiceNumber } from "@/lib/invoice";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * Give an order the next GST invoice number for the current financial year.
 * Called inside the transaction that ships the order, so numbers are unique
 * and consecutive: the counter is bumped in one statement, and if the
 * shipment rolls back so does the bump, leaving no gap in the series.
 */
export async function issueInvoiceNumber(tx: Tx, orderId: string, at: Date = new Date()): Promise<string> {
  const fy = financialYear(at);
  const [row] = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "InvoiceSequence" ("financialYear", "lastNumber") VALUES (${fy}, 1)
    ON CONFLICT ("financialYear") DO UPDATE SET "lastNumber" = "InvoiceSequence"."lastNumber" + 1
    RETURNING "lastNumber"`;
  const invoiceNumber = formatInvoiceNumber(fy, row.lastNumber);
  await tx.order.update({ where: { id: orderId }, data: { invoiceNumber, invoiceDate: at } });
  return invoiceNumber;
}
