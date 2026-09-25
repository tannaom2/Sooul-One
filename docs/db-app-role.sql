-- App-only database role (DR review, strategic item S1).
--
-- Run ONCE, in the Neon SQL editor, as the database owner (neondb_owner), on
-- the production database. Then point the app's DATABASE_URL (pooled) at this
-- role, and keep the owner in DIRECT_URL for migrations and BACKUP_DATABASE_URL
-- for backups.
--
-- What it buys: the running app can read and write rows but can't create, alter
-- or drop tables, can't rewrite the audit log, and can't touch migration
-- history, so a bug or an injected query can't destroy the schema. It also gets
-- tighter timeouts than the database default.
--
-- Before running: replace CHANGE-ME with a long random password from your
-- password manager, and neondb_owner / neondb if your names differ.

CREATE ROLE sooulone_app LOGIN PASSWORD 'CHANGE-ME';

GRANT CONNECT ON DATABASE neondb TO sooulone_app;
GRANT USAGE ON SCHEMA public TO sooulone_app;

-- Rows, not structure: existing tables...
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sooulone_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sooulone_app;
-- ...and every table future migrations create (they run as the owner).
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sooulone_app;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sooulone_app;

-- The audit log is append-only for the app, on top of the trigger that
-- already refuses UPDATE and DELETE for everyone.
REVOKE UPDATE, DELETE ON "AdminAuditLog" FROM sooulone_app;

-- Migration history is the owner's business.
REVOKE INSERT, UPDATE, DELETE ON "_prisma_migrations" FROM sooulone_app;

-- Tighter than the database-wide 30 s / 10 s: checkout's slowest transaction
-- is well under this.
ALTER ROLE sooulone_app SET statement_timeout = '15s';
ALTER ROLE sooulone_app SET lock_timeout = '5s';
ALTER ROLE sooulone_app SET idle_in_transaction_session_timeout = '60s';

-- Check: this should fail with "permission denied" when run as sooulone_app:
--   CREATE TABLE should_fail (id int);
