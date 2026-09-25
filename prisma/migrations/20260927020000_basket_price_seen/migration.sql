-- CartItem.priceAtAdd now means "the unit price the shopper saw" (after any
-- variant price and product discount), and drives the basket's "price has
-- changed since you added this" note. Rows saved before this held the
-- undiscounted base price, which would show a false "price dropped" on every
-- discounted item, so reset them to the price shown today. Same arithmetic as
-- src/lib/pricing.ts resolveUnitPrice, in integer paise.
WITH seen AS (
  SELECT
    ci.id,
    ROUND(COALESCE(v."priceOverride", p."basePrice") * 100) AS list_paise,
    p."discountActive" AS discount_on,
    p."discountPercent" AS pct
  FROM "CartItem" ci
  JOIN "Product" p ON p.id = ci."productId"
  LEFT JOIN "ProductVariant" v ON v.id = ci."variantId"
)
UPDATE "CartItem" c
SET "priceAtAdd" = (
  s.list_paise
  - CASE WHEN s.discount_on AND s.pct > 0 AND s.pct < 100 THEN ROUND(s.list_paise * s.pct / 100) ELSE 0 END
) / 100
FROM seen s
WHERE s.id = c.id;
