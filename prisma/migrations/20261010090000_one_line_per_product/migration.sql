-- One basket line per product. Two adds landing at the same moment could
-- each find no line and create one, leaving two lines for one product.
-- Existing duplicates are merged first (quantities added, capped at 20, the
-- line basket limit), then a unique index makes it impossible again.

-- Merge: the oldest line of each pair keeps the total...
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "cartId", "productId" ORDER BY id) AS rn,
         SUM(quantity) OVER (PARTITION BY "cartId", "productId") AS total
  FROM "CartItem"
)
UPDATE "CartItem" c
SET quantity = LEAST(20, r.total)
FROM ranked r
WHERE c.id = r.id AND r.rn = 1 AND r.total <> c.quantity;

-- ...and the others go.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "cartId", "productId" ORDER BY id) AS rn
  FROM "CartItem"
)
DELETE FROM "CartItem" c
USING ranked r
WHERE c.id = r.id AND r.rn > 1;

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_productId_key" ON "CartItem"("cartId", "productId");
