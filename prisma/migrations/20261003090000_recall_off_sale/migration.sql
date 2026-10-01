-- A recalled batch is off sale (launch defect D1). Product."stockQuantity",
-- the derived total the storefront and the console read, now counts only
-- batches that aren't recalled, and is recalculated when a recall is set or
-- lifted. The order's stock take refuses recalled batches too
-- (src/server/order-stock.ts), so a quote made before the recall can't sell one.

CREATE OR REPLACE FUNCTION product_stock_from_batches() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE "Product"
       SET "stockQuantity" = COALESCE((SELECT SUM("quantityRemaining") FROM "ProductBatch" WHERE "productId" = NEW."productId" AND "recalledAt" IS NULL), 0)
     WHERE id = NEW."productId";
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."productId" <> NEW."productId") THEN
    UPDATE "Product"
       SET "stockQuantity" = COALESCE((SELECT SUM("quantityRemaining") FROM "ProductBatch" WHERE "productId" = OLD."productId" AND "recalledAt" IS NULL), 0)
     WHERE id = OLD."productId";
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_stock_from_batches ON "ProductBatch";
CREATE TRIGGER product_stock_from_batches
AFTER INSERT OR DELETE OR UPDATE OF "quantityRemaining", "productId", "recalledAt" ON "ProductBatch"
FOR EACH ROW EXECUTE FUNCTION product_stock_from_batches();

-- Bring every product in line now.
UPDATE "Product" p
   SET "stockQuantity" = COALESCE((SELECT SUM(b."quantityRemaining") FROM "ProductBatch" b WHERE b."productId" = p.id AND b."recalledAt" IS NULL), 0);
