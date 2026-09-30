-- Brand family, trust and support: brand domains and social links, the top bar,
-- owner-editable site text, FAQs, /learn articles, careers, contact enquiries,
-- batch recalls, and two storefront analytics events. Additive only.

-- CreateEnum
CREATE TYPE "BrandDomainMode" AS ENUM ('OFF', 'REDIRECT', 'STANDALONE');

-- CreateEnum
CREATE TYPE "EnquiryKind" AS ENUM ('COLLABORATION', 'INTERNATIONAL', 'GENERAL');

-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'HANDLED');

-- AlterEnum


ALTER TYPE "AnalyticsEventType" ADD VALUE 'BATCH_CHECKED';
ALTER TYPE "AnalyticsEventType" ADD VALUE 'SEARCHED';

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "domain" TEXT,
ADD COLUMN     "domainMode" "BrandDomainMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "facebookUrl" TEXT,
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "xUrl" TEXT,
ADD COLUMN     "youtubeUrl" TEXT;

-- AlterTable
ALTER TABLE "ProductBatch" ADD COLUMN     "recallNote" TEXT,
ADD COLUMN     "recalledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BusinessProfile" ADD COLUMN     "cin" TEXT,
ADD COLUMN     "facebookUrl" TEXT,
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "mailingAddress" TEXT,
ADD COLUMN     "xUrl" TEXT,
ADD COLUMN     "youtubeUrl" TEXT;

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "href" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteText" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteText_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "FaqEntry" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "brandId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaqEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pillar" TEXT NOT NULL,
    "brandId" TEXT,
    "coverImageUrl" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "complianceReviewedAt" TIMESTAMP(3),
    "complianceReviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "kind" "EnquiryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "organisation" TEXT,
    "country" TEXT,
    "message" TEXT NOT NULL,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOpening" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "team" TEXT,
    "location" TEXT NOT NULL,
    "employmentType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "applyUrl" TEXT,
    "applyEmail" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ArticleToProduct" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ArticleToProduct_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "FaqEntry_published_topic_idx" ON "FaqEntry"("published", "topic");

-- CreateIndex
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");

-- CreateIndex
CREATE INDEX "Article_published_publishedAt_idx" ON "Article"("published", "publishedAt");

-- CreateIndex
CREATE INDEX "Enquiry_status_createdAt_idx" ON "Enquiry"("status", "createdAt");

-- CreateIndex
CREATE INDEX "_ArticleToProduct_B_index" ON "_ArticleToProduct"("B");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_domain_key" ON "Brand"("domain");

-- AddForeignKey
ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ArticleToProduct" ADD CONSTRAINT "_ArticleToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ArticleToProduct" ADD CONSTRAINT "_ArticleToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The top bar's starting messages (from the owner's brief). {tokens} are filled
-- from the live settings (src/lib/site-content.ts), so the amounts can't drift
-- from checkout. Editable under Settings → Top bar.
INSERT INTO "Announcement" ("id", "text", "href", "enabled", "sortOrder", "updatedAt") VALUES
  ('ann_area',     'We only deliver in {area}',                       '/policies/shipping', true, 0, CURRENT_TIMESTAMP),
  ('ann_free',     'Free shipping above {freeDelivery}',              NULL,                 true, 1, CURRENT_TIMESTAMP),
  ('ann_discount', 'Discounts applied automatically in your basket',  NULL,                 true, 2, CURRENT_TIMESTAMP),
  ('ann_dispatch', 'Orders dispatched within 48–72 hours',            NULL,                 true, 3, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Starting FAQs. Published: only answers the store's own settings and systems
-- make true. Drafts (published = false): answers that are the owner's policy
-- to write (returns, refunds, damaged parcels, sourcing, suitability). The
-- draft text says what to write; nothing unpublished reaches shoppers.
INSERT INTO "FaqEntry" ("id", "question", "answer", "topic", "sortOrder", "published", "updatedAt") VALUES
  ('faq_confirmed', 'How do I know my order is confirmed?',
   'As soon as it''s placed you see your order number on screen (it looks like SO-XXXXXXXX-XX), and we email a confirmation to the address you gave. To check it later, open Help (bottom right) and enter the order number with the mobile number or email you ordered with.',
   'ORDERS', 0, true, CURRENT_TIMESTAMP),
  ('faq_cod_track', 'I chose cash on delivery. How do I track my order?',
   'Exactly like a prepaid order: open Help (bottom right) and enter your order number with the mobile number or email you ordered with. Once it''s with the courier you''ll see the tracking number too. Keep the cash ready for the delivery person; there''s no extra charge for cash on delivery.',
   'ORDERS', 1, true, CURRENT_TIMESTAMP),
  ('faq_not_dispatched', 'My order hasn''t been dispatched yet. Is something wrong?',
   'Orders are dispatched within 48–72 hours of being placed, a little longer over Sundays and public holidays. If it''s been longer than that, message us with your order number and we''ll check.',
   'ORDERS', 2, true, CURRENT_TIMESTAMP),
  ('faq_area', 'Where do you deliver?',
   'We deliver only within {area} for now. Enter your pincode at checkout, or in Help, to see the delivery date for your address.',
   'DELIVERY', 0, true, CURRENT_TIMESTAMP),
  ('faq_fees', 'What does delivery cost?',
   'Delivery is {deliveryFee} per order, and free on orders above {freeDelivery}. Nothing else is added at checkout: no handling, packing or cash-on-delivery fees.',
   'DELIVERY', 1, true, CURRENT_TIMESTAMP),
  ('faq_outside', 'Do you deliver outside {area}, or outside India?',
   'Not yet. For deliveries outside India, fill in the international enquiry on our Contact page and we''ll get back to you.',
   'DELIVERY', 2, true, CURRENT_TIMESTAMP),
  ('faq_late', 'My delivery is late, or the tracking hasn''t moved.',
   'DRAFT: say how many days past the promised date the shopper should wait, what you do about it (chase the courier, reship, refund), and how to reach you.',
   'DELIVERY', 3, false, CURRENT_TIMESTAMP),
  ('faq_pay', 'Which ways can I pay?',
   'Online with UPI, cards, net banking or wallets, handled securely by Razorpay, or cash on delivery where it''s offered for your pincode and order value. Checkout shows what''s available for you.',
   'PAYMENTS', 0, true, CURRENT_TIMESTAMP),
  ('faq_discounts', 'Are discounts applied automatically?',
   'Yes. Product discounts and combo offers are applied in your basket by themselves. If you have a discount code, enter it in the basket.',
   'PAYMENTS', 1, true, CURRENT_TIMESTAMP),
  ('faq_debited', 'Money was taken but my order didn''t go through.',
   'DRAFT: say how quickly a failed payment is refunded (the bank usually reverses it within 5–7 working days), and how to reach you with the payment reference.',
   'PAYMENTS', 2, false, CURRENT_TIMESTAMP),
  ('faq_returns', 'Can I return or exchange a product?',
   'DRAFT: your return and exchange policy: which items, how many days after delivery, and in what condition. Opened food and supplements usually can''t be taken back; say plainly what always is (damaged, wrong or short-dated on arrival).',
   'RETURNS', 0, false, CURRENT_TIMESTAMP),
  ('faq_damaged', 'My parcel arrived damaged.',
   'DRAFT: what to do (photos of the parcel, the pack and the batch code), by when, and what you''ll do (replace or refund).',
   'RETURNS', 1, false, CURRENT_TIMESTAMP),
  ('faq_partial', 'Part of my order is missing.',
   'DRAFT: whether orders can arrive in more than one parcel, and what to do if an item is missing.',
   'RETURNS', 2, false, CURRENT_TIMESTAMP),
  ('faq_refunds', 'How are refunds paid?',
   'DRAFT: back to the original payment method within how many working days, and how cash-on-delivery refunds are paid.',
   'RETURNS', 3, false, CURRENT_TIMESTAMP),
  ('faq_genuine', 'How do I check my product is genuine?',
   'Enter the batch number printed on your pack on our Verify page. You''ll see the product, when that batch was made and its best-before date. Buying from our website or our own stores is the surest way to get genuine stock.',
   'AUTHENTICITY', 0, true, CURRENT_TIMESTAMP),
  ('faq_packaging', 'My pack looks different from the photos. Is it genuine?',
   'We continuously innovate throughout our value chain, with packaging being a vital cog in the wheel. We make fine changes in design, copy and text to follow packaging guidelines and for practical reasons, so a pack can differ slightly from the photos. You can check your batch on our Verify page.',
   'AUTHENTICITY', 1, true, CURRENT_TIMESTAMP),
  ('faq_best_before', 'How long will my product last?',
   'Every product page shows the best-before date of the pack we''d send you, not just the shelf life. Store it as the label says, and check the date on the pack when it arrives.',
   'PRODUCTS', 0, true, CURRENT_TIMESTAMP),
  ('faq_sourcing', 'Where do your ingredients come from?',
   'DRAFT: where the main ingredients are sourced and how suppliers are checked. Only what you can stand behind.',
   'PRODUCTS', 1, false, CURRENT_TIMESTAMP),
  ('faq_veg', 'Are your gummies vegetarian?',
   'DRAFT: gelatin or pectin, per brand. Every product page shows the veg or non-veg mark from the label.',
   'PRODUCTS', 2, false, CURRENT_TIMESTAMP),
  ('faq_suitability', 'Can children, or pregnant or breastfeeding women, take your supplements?',
   'DRAFT: the suitability and "consult your doctor" wording from the labels. Keep to what the labels say.',
   'PRODUCTS', 3, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
