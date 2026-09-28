/**
 * Demo data for Make Your Own Box and referrals. Called by generateDemo (so a
 * fresh demo has them) and by `npm run demo:growth` (to add them to a demo
 * database built before these features). Demo database only; every write is
 * idempotent, so running it twice changes nothing.
 *
 * Boxes are one type each (a Box of Gummies or a True Store box) with one
 * rule: that type's products in a price range. The old mixed Family Box, if
 * an older demo has it, is switched off rather than deleted.
 *
 * Box pools fill themselves the first time a box page is viewed (or from
 * Admin → Boxes → Refresh pool), with the same rules the live site uses.
 */
import type { PrismaClient } from "@prisma/client";

const priced = (rupees: number) => String(rupees);

export async function seedGrowth(db: PrismaClient): Promise<{ boxes: number; costsSet: number; referrals: number }> {
  // Landed cost: about 42% of the shelf price, so the margin check has something to check.
  const uncosted = await db.product.findMany({ where: { unitCost: null }, select: { id: true, basePrice: true } });
  for (const p of uncosted) {
    await db.product.update({ where: { id: p.id }, data: { unitCost: priced(Math.round(Number(p.basePrice) * 0.42)) } });
  }

  await db.referralProgram.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", isActive: true, monthlyBudget: priced(5000) },
  });

  const brands = await db.brand.findMany({ select: { id: true, slug: true } });
  const brand = (slug: string) => brands.find((b) => b.slug === slug)?.id;
  const gummies = ["woman-axis", "man-rituals", "kids-vault"].map(brand).filter((x): x is string => Boolean(x));

  const trueStore = [brand("the-true-store")].filter((x): x is string => Boolean(x));

  let boxes = 0;
  const addBox = async (data: Parameters<typeof db.box.create>[0]["data"]) => {
    if (await db.box.findUnique({ where: { slug: data.slug } })) return;
    await db.box.create({ data });
    boxes++;
  };
  // One rule per box: its type's brands, in a price range that keeps every box a saving and above cost.
  await addBox({
    slug: "gummies-box",
    name: "Gummies Box",
    kind: "GUMMIES",
    description: "Any three from Woman Axis, Man Rituals and Kids Vault. Mix them however you like.",
    price: priced(999),
    size: 3,
    maxPerProduct: 1,
    isActive: true,
    slots: { create: [{ label: "Pick any", sortOrder: 0, brandIds: gummies, minPrice: priced(399), maxPrice: priced(699) }] },
  });
  await addBox({
    slug: "true-store-box",
    name: "True Store Box",
    kind: "TRUE_STORE",
    description: "Any four healthy snacks: namkeen, sweets and munchies.",
    price: priced(499),
    size: 4,
    maxPerProduct: 1,
    isActive: true,
    slots: { create: [{ label: "Pick any", sortOrder: 0, brandIds: trueStore, minPrice: priced(129), maxPrice: priced(349) }] },
  });
  await addBox({
    slug: "clearance-box",
    name: "Last-Chance Box",
    kind: "GUMMIES",
    description: "Gummies nearing their shipping cut-off or overstocked, every pack still well within the freshness rule.",
    price: priced(899),
    size: 3,
    maxPerProduct: 2,
    isActive: false,
    slots: {
      create: [{ label: "Pick any", sortOrder: 0, brandIds: gummies, mode: "CLEARANCE", nearExpiryDays: 120, minDaysOfCover: 120, minPrice: priced(399), maxPrice: priced(599) }],
    },
  });

  // Demos built before box types: retire the mixed Family Box, and make the
  // Last-Chance Box gummies-only with one rule.
  await db.box.updateMany({ where: { slug: "family-box", isActive: true }, data: { isActive: false } });
  const lastChance = await db.box.findUnique({ where: { slug: "clearance-box" }, include: { slots: { orderBy: { sortOrder: "asc" } } } });
  if (lastChance && lastChance.slots.length > 1) {
    const [keep, ...rest] = lastChance.slots;
    await db.boxSlot.deleteMany({ where: { id: { in: rest.map((r) => r.id) } } });
    await db.boxSlot.update({ where: { id: keep.id }, data: { label: "Pick any", brandIds: gummies, minPrice: priced(399), maxPrice: priced(599) } });
    await db.box.update({ where: { id: lastChance.id }, data: { kind: "GUMMIES", price: priced(899), poolRefreshedAt: null } });
  }

  // Sample referrals, if the shoppers used in testing exist: one on its way,
  // one waiting for review. Codes are made for the referrer.
  let referrals = 0;
  const byPhone = async (phone: string) => db.customer.findUnique({ where: { phone }, select: { id: true, name: true } });
  const [mansi, riya, kiran] = await Promise.all([byPhone("8539024134"), byPhone("9427001122"), byPhone("9725003344")]);
  if (mansi) {
    const code = await db.referralCode.upsert({ where: { customerId: mansi.id }, update: {}, create: { customerId: mansi.id, code: "MANSI7K2" } });
    const firstOrder = async (customerId: string) =>
      db.order.findFirst({ where: { customerId }, orderBy: { placedAt: "asc" }, select: { id: true } });
    for (const [friend, flagged] of [[riya, false], [kiran, true]] as const) {
      if (!friend || (await db.referral.findUnique({ where: { refereeId: friend.id } }))) continue;
      const order = await firstOrder(friend.id);
      if (order && (await db.referral.findUnique({ where: { qualifyingOrderId: order.id } }))) continue;
      await db.referral.create({
        data: {
          codeId: code.id,
          referrerId: mansi.id,
          refereeId: friend.id,
          via: "LINK",
          status: order ? "QUALIFYING" : "ATTRIBUTED",
          qualifyingOrderId: order?.id ?? null,
          riskScore: flagged ? 60 : 0,
          riskSignals: flagged ? { atSignUp: ["Delivers to an address the referrer uses"] } : { atSignUp: [] },
          flagged,
          events: { create: { toStatus: order ? "QUALIFYING" : "ATTRIBUTED", actor: "SYSTEM", detail: { demo: true } } },
        },
      });
      referrals++;
    }
  }
  return { boxes, costsSet: uncosted.length, referrals };
}
