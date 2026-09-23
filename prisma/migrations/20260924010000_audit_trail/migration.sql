-- AdminAuditLog: optional author (failed sign-ins for unknown emails), plus
-- actor email, IP and user agent. RESTRICT so deleting an admin can't strip
-- authorship off their history.
ALTER TABLE "AdminAuditLog" DROP CONSTRAINT "AdminAuditLog_adminUserId_fkey";
ALTER TABLE "AdminAuditLog" ADD COLUMN "actorEmail" TEXT,
ADD COLUMN "ipAddress" TEXT,
ADD COLUMN "userAgent" TEXT,
ALTER COLUMN "adminUserId" DROP NOT NULL;
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AdminAuditLog_adminUserId_createdAt_idx" ON "AdminAuditLog"("adminUserId", "createdAt");
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- Backfill: existing entries get their author's email.
UPDATE "AdminAuditLog" l SET "actorEmail" = u."email" FROM "AdminUser" u WHERE l."adminUserId" = u."id";

-- OrderEvent: the per-order timeline.
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorEmail" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing order starts its timeline with when it was placed.
INSERT INTO "OrderEvent" ("id", "orderId", "type", "actorType", "detail", "createdAt")
SELECT gen_random_uuid()::text, o."id", 'PLACED', 'CUSTOMER',
       jsonb_build_object('method', o."paymentGateway", 'backfilled', true), o."placedAt"
FROM "Order" o;

-- Append-only audit log. Created last, after the backfill UPDATE above.
CREATE FUNCTION "admin_audit_log_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AdminAuditLog is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "admin_audit_log_no_update_delete"
BEFORE UPDATE OR DELETE ON "AdminAuditLog"
FOR EACH ROW EXECUTE FUNCTION "admin_audit_log_immutable"();

CREATE TRIGGER "admin_audit_log_no_truncate"
BEFORE TRUNCATE ON "AdminAuditLog"
FOR EACH STATEMENT EXECUTE FUNCTION "admin_audit_log_immutable"();
