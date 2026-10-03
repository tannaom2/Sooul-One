-- The recall notice emailed to a recalled batch's buyers, and when it went
-- (FSSAI Food Recall Procedure Regulations 2017: notify those who received it).

-- AlterTable
ALTER TABLE "ProductBatch" ADD COLUMN     "recallNoticeText" TEXT,
ADD COLUMN     "recallNotifiedAt" TIMESTAMP(3);
