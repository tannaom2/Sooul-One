# Disaster recovery

What to do when the database is damaged, lost, or unreachable, and how backups work. Keep this short enough to follow at 2 a.m.

## Targets

| What happened | Data you can lose (RPO) | Time to recover (RTO) | Use |
|---|---|---|---|
| Bad deploy, bad migration, rows deleted by mistake | 0–5 minutes | 30 minutes | **A.** Neon point-in-time restore |
| Render (app host) is down | none | about 1 hour | Wait for Render, or redeploy elsewhere; the database is unaffected |
| Neon's region is down | up to 24 hours | about 4 hours | **B.** Restore the latest backup into a new Neon project in another region |
| Neon account lost, deleted or compromised | up to 24 hours | 4–8 hours | **B.** The nightly backup is the only copy outside Neon |

Orders placed in the lost window can be rebuilt: paid ones from Razorpay (Admin → Reconciliation), cash-on-delivery ones from the order confirmation emails in Resend. Orders and invoices are never deleted in normal running: GST law requires keeping them for 72 months.

## How backups work

- **Every night at 03:00 IST**, the `Database backup` GitHub Actions workflow dumps the database with Postgres 18's `pg_dump`.
- **Every backup is test-restored** into a throwaway Postgres in the same job, and every table's row count is compared with the live database. Any difference fails the run, and GitHub emails the workflow's owner.
- The dump is then **encrypted** with [age](https://age-encryption.org) to the public key in `.github/backup-recipient.txt`, the plain dump is deleted, and the encrypted file is kept as a workflow artifact for **30 days**.
- **Only the owner's private key can open a backup.** It lives in the owner's password manager, never on GitHub or in the repo. Without it, nobody can read a backup, the owner included.
- Live backups need the repository secret `BACKUP_DATABASE_URL`: the database's **direct** (not pooled) connection string. Without it, the workflow runs a rehearsal against a test database, so the pipeline is still exercised nightly.

## A. Point-in-time restore (same Neon project)

For mistakes inside the last few days (the window depends on the Neon plan).

1. Note the time just **before** the problem, in UTC.
2. Neon console → the project → **Branches** → **Restore** (or create a branch "from a point in time") at that moment.
3. Check the restored branch: open it in the Neon SQL editor and look at the tables involved.
4. Point the app at it: in Render, set `DATABASE_URL` to the restored branch's **pooled** connection string, then redeploy.
5. Run **After any restore**, below.

## B. Restore from a nightly backup (new project or new provider)

1. **Download.** GitHub → the repository → **Actions** → **Database backup** → the latest green run → **Artifacts** → download the `sooulone-…-live.dump` zip, then unzip it. It contains `….dump.age` and `….dump.manifest.json`.
2. **Decrypt.** Save the private key from your password manager to a file outside the project, for example `C:\Users\you\backup-key.txt`, then run:
   ```
   npx tsx scripts/backup-decrypt.mts path\to\sooulone-….dump.age C:\Users\you\backup-key.txt
   ```
   It checks the SHA-256 against the manifest. **Delete the key file afterwards.** If the checksum fails, use the previous night's backup.
3. **Create the new database.** For example, a new Neon project in the nearest healthy region, on Postgres 18 or later.
4. **Restore.** This needs `pg_restore` version 18 or later, either installed locally or through Docker:
   ```
   docker run --rm -v "%CD%:/work" postgres:18 pg_restore --no-owner --no-privileges --exit-on-error --dbname="<NEW DIRECT URL>" /work/sooulone-….dump
   ```
5. **Check it.** Row counts on `Order`, `OrderItem`, `Product` and `ProductBatch` should look right. `npx prisma migrate status`, run with the new URL, should say the schema is up to date.
6. **Switch the app.** In Render, set `DATABASE_URL` (pooled) and the direct URL, then redeploy.
7. Run **After any restore**, below.

## After any restore

- Admin → **Reconciliation**: bring back paid orders placed after the restore point.
- Look for cash-on-delivery orders in the lost window in the Resend email log, and re-enter them if needed.
- Admin → **Launch checklist** and **Store controls**: confirm settings came back as expected.
- If more than a few minutes of orders were lost, pause orders (Store controls) while you reconcile.
- Write a short note of what happened, the restore point used, and what was re-entered.

## Database settings

- **Two connection strings.** `DATABASE_URL` is the **pooled** one, used by the app. `DIRECT_URL` is the **direct** one, used only by migrations (Prisma's migration lock is unreliable through the pooler). `BACKUP_DATABASE_URL` (a GitHub secret) is also direct.
- **Timeouts** are set on the database itself (migration `20260927010000`): 30 s per statement, 10 s waiting for a lock, 60 s idle inside a transaction. New connections pick them up at once; the pooler's existing connections pick them up as they're recycled, or immediately after a compute restart in the Neon console.
- **Rules on values** (CHECK constraints) stop impossible data whatever writes it: negative prices or totals, ratings outside 1–5, basket quantities outside 1–20, expiry before manufacture, stock below zero.
- **App-only role:** `docs/db-app-role.sql` creates a role that can change rows but not tables. Set it up on the production database when it moves to Singapore.

## Keys and secrets

Keep these in the owner's password manager. They can't be recovered from anywhere else:

| Secret | If lost |
|---|---|
| Backup private key (`AGE-SECRET-KEY-…`) | Existing backups can never be opened. Make a new pair (below) immediately. |
| `JWT_SECRET` | Everyone is signed out and every 2FA recovery code stops working |
| Razorpay key secret and webhook secret | Regenerate in the Razorpay dashboard |
| `RESEND_API_KEY`, `CLOUDINARY_URL`, `CRON_SECRET` | Regenerate in each service |
| Neon owner password and connection strings | Reset in the Neon console |

**Rotating the backup key.** Run `npx tsx scripts/backup-keygen.mts C:\Users\you\new-key.txt`, commit the new `.github/backup-recipient.txt`, and store the new private key. Keep the old one until the last backup made with it has expired (30 days).

## Drills

- **Nightly (automatic):** every backup is test-restored and compared, table by table.
- **Monthly (owner, 10 minutes):** download last night's backup and decrypt it (step B.2). This proves the private key in your password manager still opens it.
- **Quarterly (with a developer, about 1 hour):** full restore (B.1–B.5) into a throwaway Neon branch. Time it and note it here.

| Date | Drill | Result | Time taken |
|---|---|---|---|
| 2026-09-25 | Key round trip: encrypt with the committed public key, decrypt with the owner's private key | Identical, checksum matched | under a minute |
