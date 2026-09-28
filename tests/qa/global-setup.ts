/**
 * QA suite setup: demo database fixtures, and proof the server under test is
 * the demo (never the real store).
 */
import { BASE, PRODUCTS, SINGLE_USE_COUPON, cleanup, closeDemo, demo } from "./fixtures";

export default async function globalSetup() {
  const db = await demo(); // refuses anything but *_demo
  await cleanup(); // a crashed earlier run leaves nothing behind

  const category = await db.category.findFirstOrThrow({ where: { brand: { slug: "the-true-store" }, isActive: true }, include: { brand: true } });
  const far = new Date(Date.now() + 400 * 86_400_000);
  const made = new Date(Date.now() - 20 * 86_400_000);
  for (const [key, p] of Object.entries(PRODUCTS)) {
    await db.product.create({
      data: {
        slug: p.slug,
        sku: p.sku,
        name: key === "lastUnit" ? "QA Last Unit Namkeen" : "QA Plenty Namkeen",
        brandId: category.brandId,
        categoryId: category.id,
        regulatoryType: "PACKAGED_FOOD",
        shortDescription: "QA fixture.",
        description: "QA fixture product. Removed after the suite runs.",
        basePrice: String(p.price),
        mrp: String(p.price),
        taxRatePercent: "12",
        hsnCode: "21069099",
        isActive: true,
        isVeg: true,
        shelfLifeDays: 540,
        netQuantity: "200 g",
        manufacturerName: "QA",
        manufacturerAddress: "QA",
        countryOfOrigin: "India",
        ingredients: "QA",
        nutritionFacts: { servingSizeG: 30, energyKcal: 120, proteinG: 3, carbohydrateG: 15, totalSugarsG: 1, totalFatG: 5, saturatedFatG: 1, transFatG: 0, fibreG: 2, sodiumMg: 100 },
        batches: {
          create: { batchNumber: `${p.sku}-B1`, manufacturedOn: made, expiresOn: far, quantityReceived: key === "lastUnit" ? 1 : 500, quantityRemaining: key === "lastUnit" ? 1 : 500 },
        },
      },
    });
  }
  await db.coupon.create({
    data: { code: SINGLE_USE_COUPON, discountType: "FLAT", discountValue: "50", maxUses: 1, validFrom: new Date(Date.now() - 86_400_000), validUntil: far, isActive: true },
  });

  // The server must be reading the demo database: only the demo has this product.
  let seen = 0;
  for (let i = 0; i < 5 && seen !== 200; i++) {
    seen = await fetch(`${BASE}/product/${PRODUCTS.plenty.slug}`).then((r) => r.status).catch(() => 0);
    if (seen !== 200) await new Promise((r) => setTimeout(r, 3000));
  }
  if (seen !== 200) {
    await cleanup();
    await closeDemo();
    throw new Error(`The server at ${BASE} isn't the demo (it can't see the QA fixture). Start it with: npm run demo:start`);
  }
  await closeDemo();
}
