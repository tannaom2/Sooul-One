-- An order records the Make Your Own Boxes in it, so "Order again" can put
-- each one back as a box at the box price instead of as loose items.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "boxSnapshot" JSONB;
