import "server-only";
import { db } from "@/lib/db";
import type { BatchFacts } from "@/lib/batch-verify";

/**
 * Batches whose number matches a normalised code (src/lib/batch-verify.ts),
 * ignoring case, spaces and punctuation on both sides. Discontinued products
 * still match: a pack bought last year is no less genuine. The same number
 * can exist on two products (numbers are unique per product), so up to five.
 */
export async function findBatches(normalized: string): Promise<BatchFacts[]> {
  const rows = await db.$queryRaw<
    { batchNumber: string; manufacturedOn: Date; expiresOn: Date; recalledAt: Date | null; recallNote: string | null; productName: string; productSlug: string; brandName: string }[]
  >`
    SELECT b."batchNumber", b."manufacturedOn", b."expiresOn", b."recalledAt", b."recallNote",
           p."name" AS "productName", p."slug" AS "productSlug", br."name" AS "brandName"
    FROM "ProductBatch" b
    JOIN "Product" p ON p."id" = b."productId"
    JOIN "Brand" br ON br."id" = p."brandId"
    WHERE regexp_replace(upper(b."batchNumber"), '[^A-Z0-9]', '', 'g') = ${normalized}
    ORDER BY b."manufacturedOn" DESC
    LIMIT 5`;
  return rows.map((r) => ({ ...r, manufacturedOn: new Date(r.manufacturedOn), expiresOn: new Date(r.expiresOn), recalledAt: r.recalledAt ? new Date(r.recalledAt) : null }));
}
