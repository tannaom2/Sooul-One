-- Sugar per serving (number shown on the page) and age suitability.
ALTER TABLE "Product" ADD COLUMN "sugarPerServingG" DECIMAL(6,2),
ADD COLUMN "suitableFromAge" INTEGER,
ADD COLUMN "suitableToAge" INTEGER;
