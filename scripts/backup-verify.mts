/**
 * Nightly backup, step 2 (run in GitHub Actions): prove the dump restores by
 * comparing every table's row count in the live database with the copy just
 * restored from the dump. Fails the job on any difference, so a broken backup
 * is found the night it's made, not the day it's needed.
 *
 *   SOURCE_URL=... RESTORED_URL=... npx tsx scripts/backup-verify.mts
 */
import pg from "pg";
import { compareCounts } from "./backup-lib";

async function counts(url: string): Promise<Record<string, number>> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 30000 });
  await client.connect();
  try {
    const tables = await client.query<{ t: string }>(
      `SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const out: Record<string, number> = {};
    for (const { t } of tables.rows) {
      out[t] = Number((await client.query(`SELECT count(*)::bigint AS n FROM "${t.replace(/"/g, '""')}"`)).rows[0].n);
    }
    return out;
  } finally {
    await client.end();
  }
}

const source = await counts(process.env.SOURCE_URL!);
const restored = await counts(process.env.RESTORED_URL!);
const mismatches = compareCounts(source, restored);
const total = Object.values(source).reduce((a, b) => a + b, 0);

if (mismatches.length) {
  console.error("Backup verification FAILED. Row counts differ:");
  for (const m of mismatches) console.error(`  ${m.table}: live ${m.source}, restored ${m.restored ?? "missing"}`);
  process.exit(1);
}
console.log(`Backup verified: ${Object.keys(source).length} tables, ${total} rows, identical after restore.`);
