-- Database hardening (DR review, 2026-09-26): foreign-key and lookup indexes,
-- rules that keep impossible values out whatever writes them, and timeouts
-- so one stuck query or lock can't hold up checkout.

-- ---------------------------------------------------------------------------
-- 1. Indexes. Postgres doesn't index foreign keys by itself.
-- CreateIndex
CREATE INDEX "BundleEligibleProduct_productId_idx" ON "BundleEligibleProduct"("productId");

-- CreateIndex
CREATE INDEX "CartItem_cartId_idx" ON "CartItem"("cartId");

-- CreateIndex
CREATE INDEX "CartItem_productId_idx" ON "CartItem"("productId");

-- CreateIndex
CREATE INDEX "Order_paymentId_idx" ON "Order"("paymentId");

-- CreateIndex
CREATE INDEX "Order_guestEmail_placedAt_idx" ON "Order"("guestEmail", "placedAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderItem_batchId_idx" ON "OrderItem"("batchId");

-- CreateIndex
CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage"("productId", "sortOrder");

-- CreateIndex
CREATE INDEX "Review_productId_isApproved_idx" ON "Review"("productId", "isApproved");


-- ---------------------------------------------------------------------------
-- 2. Rules on values. The app validates all of these already; the database
-- enforces them too, so a script, a bug or a manual edit can't store them.
-- GST allows rates up to 40% since GST 2.0 (Sept 2025).
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_prices_nonnegative" CHECK ("basePrice" >= 0 AND ("compareAtPrice" IS NULL OR "compareAtPrice" >= 0) AND (mrp IS NULL OR mrp >= 0)),
  ADD CONSTRAINT "Product_discountPercent_range" CHECK ("discountPercent" IS NULL OR ("discountPercent" >= 0 AND "discountPercent" <= 100)),
  ADD CONSTRAINT "Product_taxRatePercent_range" CHECK ("taxRatePercent" >= 0 AND "taxRatePercent" <= 40),
  ADD CONSTRAINT "Product_sugar_nonnegative" CHECK ("sugarPerServingG" IS NULL OR "sugarPerServingG" >= 0),
  ADD CONSTRAINT "Product_ages_sane" CHECK (("suitableFromAge" IS NULL OR "suitableFromAge" >= 0) AND ("suitableToAge" IS NULL OR "suitableFromAge" IS NULL OR "suitableToAge" >= "suitableFromAge"));

ALTER TABLE "ProductBatch"
  ADD CONSTRAINT "ProductBatch_quantities_sane" CHECK ("quantityReceived" > 0 AND "quantityRemaining" <= "quantityReceived"),
  ADD CONSTRAINT "ProductBatch_dates_sane" CHECK ("expiresOn" > "manufacturedOn");

ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_price_nonnegative" CHECK ("priceOverride" IS NULL OR "priceOverride" >= 0);

ALTER TABLE "CartItem"
  ADD CONSTRAINT "CartItem_quantity_range" CHECK (quantity >= 1 AND quantity <= 20);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_values_sane" CHECK (quantity >= 1 AND "lineTotal" >= 0 AND "unitPriceSnapshot" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_amounts_nonnegative" CHECK (
    subtotal >= 0 AND "totalAmount" >= 0 AND "taxAmount" >= 0 AND "shippingAmount" >= 0
    AND "discountAmount" >= 0 AND "bundleDiscountAmount" >= 0 AND "productDiscountAmount" >= 0
  );

ALTER TABLE "Review"
  ADD CONSTRAINT "Review_rating_range" CHECK (rating >= 1 AND rating <= 5);

ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_values_sane" CHECK (
    "discountValue" > 0 AND "usedCount" >= 0 AND ("maxUses" IS NULL OR "maxUses" > 0)
    AND "validUntil" >= "validFrom" AND ("discountType" <> 'PERCENTAGE' OR "discountValue" <= 100)
  );

ALTER TABLE "Bundle"
  ADD CONSTRAINT "Bundle_values_sane" CHECK ("discountValue" > 0 AND "minItems" >= 1 AND ("maxItems" IS NULL OR "maxItems" >= "minItems"));

-- ---------------------------------------------------------------------------
-- 3. Timeouts, for every new session on this database. pg_dump sets its own
-- (unlimited) statement timeout, so backups aren't affected; a migration that
-- genuinely needs longer can SET LOCAL statement_timeout for itself.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET statement_timeout = %L', current_database(), '30s');
  EXECUTE format('ALTER DATABASE %I SET lock_timeout = %L', current_database(), '10s');
  EXECUTE format('ALTER DATABASE %I SET idle_in_transaction_session_timeout = %L', current_database(), '60s');
END
$$;
