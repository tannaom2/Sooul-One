-- OrderEvent.type and actorType were free text (audit L1). Converted in place
-- with a cast, not dropped and re-added, so existing timelines are kept. Every
-- stored value was checked to be in these lists before this was written; an
-- unexpected value makes the cast fail and the migration roll back.
CREATE TYPE "OrderEventType" AS ENUM ('PLACED', 'PAYMENT_CAPTURED', 'PAYMENT_FAILED', 'REFUNDED', 'STATUS_CHANGED', 'EMAIL_SENT', 'NOTE');
CREATE TYPE "OrderEventActor" AS ENUM ('CUSTOMER', 'SYSTEM', 'ADMIN');

ALTER TABLE "OrderEvent"
  ALTER COLUMN "type" TYPE "OrderEventType" USING "type"::"OrderEventType",
  ALTER COLUMN "actorType" TYPE "OrderEventActor" USING "actorType"::"OrderEventActor";
