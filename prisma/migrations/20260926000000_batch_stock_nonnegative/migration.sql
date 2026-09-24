-- Batch stock can never go below zero, whatever code path writes it.
-- create-order already decrements conditionally (audit C2); this is the
-- backstop. Prisma's schema language can't express CHECK constraints, so it
-- lives only here.
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_quantityRemaining_nonnegative" CHECK ("quantityRemaining" >= 0);
