-- Batches are the only stock record (audit H3). Product."stockQuantity"
-- becomes a derived total, kept equal to the sum of the product's batch
-- "quantityRemaining" by this trigger, whatever code path writes a batch.
-- Nothing in the app sets it directly any more, so admin and storefront can't
-- disagree about stock. A product with no batches has nothing to sell.
--
-- The trigger doesn't touch Product."updatedAt": a sale changing stock must
-- not look like an edit to someone who has the product form open.

CREATE OR REPLACE FUNCTION product_stock_from_batches() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE "Product"
       SET "stockQuantity" = COALESCE((SELECT SUM("quantityRemaining") FROM "ProductBatch" WHERE "productId" = NEW."productId"), 0)
     WHERE id = NEW."productId";
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."productId" <> NEW."productId") THEN
    UPDATE "Product"
       SET "stockQuantity" = COALESCE((SELECT SUM("quantityRemaining") FROM "ProductBatch" WHERE "productId" = OLD."productId"), 0)
     WHERE id = OLD."productId";
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_stock_from_batches
AFTER INSERT OR DELETE OR UPDATE OF "quantityRemaining", "productId" ON "ProductBatch"
FOR EACH ROW EXECUTE FUNCTION product_stock_from_batches();

-- Bring every product in line with its batches now.
UPDATE "Product" p
   SET "stockQuantity" = COALESCE((SELECT SUM(b."quantityRemaining") FROM "ProductBatch" b WHERE b."productId" = p.id), 0);

-- The backstop promised with the batch constraint (audit C2).
ALTER TABLE "Product" ADD CONSTRAINT "Product_stockQuantity_nonnegative" CHECK ("stockQuantity" >= 0);
