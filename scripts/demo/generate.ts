/**
 * Builds the demo dataset and writes it to the demo database.
 *
 * Realism comes from reusing the app's own rules rather than imitating them:
 * every product passes productInputSchema (claims check included), every
 * order is priced by buildQuote exactly as checkout prices it (discounts,
 * bundles, coupons, delivery, GST), item rows are apportioned the way
 * create-order does it, invoices are numbered consecutively in ship order, and
 * stock is the batch quantities left after every order that took stock.
 *
 * Deterministic (seeded PRNG) but anchored to "now", so the dashboard always
 * shows a store with orders from this morning.
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import { buildQuote, type QuoteLineInput } from "@/lib/checkout/quote";
import type { BundleRule } from "@/lib/checkout/bundles";
import { resolveUnitPrice } from "@/lib/pricing";
import { apportion, financialYear, formatInvoiceNumber } from "@/lib/invoice";
import { fromPaise } from "@/lib/money";
import { productInputSchema } from "@/lib/validation/product";
import { MARKETING_CONSENT_TEXT } from "@/lib/consent";
import { CATALOGUE, MAKERS, type DemoProduct } from "./catalogue";
import {
  BUILDING_KINDS, BUILDING_WORDS, CITIES, COURIERS, EMAIL_DOMAINS, FIRST_NAMES_F, FIRST_NAMES_M, LAST_NAMES,
  COD_NOTE, ORDER_NOTES, PENDING_REVIEWS, REVIEWS, STAFF, STORES, type ReviewKind,
} from "./people";
import { DAY, prng, type Rng } from "./lib";

const HISTORY_DAYS = 90;
const CONVERSION = 0.024; // sessions that end in an order

export interface DemoSummary {
  products: number; batches: number; orders: number; orderItems: number; orderEvents: number; reviews: number;
  pendingReviews: number; analyticsEvents: number; sessions: number; auditRows: number; invoices: number;
  revenuePaise: number; staff: number;
}

type ProductRow = DemoProduct & { id: string; brandId: string; categoryId: string; unitPaise: number; listPaise: number };
type BatchPlan = { id: string; productId: string; number: string; mfg: Date; exp: Date; arrival: Date; sold: number; remaining: number };

/* -------------------------------------------------------------- helpers */

const at = (base: Date, days: number, hour?: number, minute?: number) => {
  const d = new Date(base.getTime() + days * DAY);
  if (hour !== undefined) {
    // IST wall-clock hour → UTC.
    d.setUTCHours(hour - 5, (minute ?? 0) - 30, 0, 0);
  }
  return d;
};

function kindOf(p: DemoProduct): ReviewKind {
  if (p.brand === "woman-axis") return "women";
  if (p.brand === "kids-vault") return "kids";
  if (p.brand === "man-rituals") return "men";
  return ({ "Healthy Namkeen": "namkeen", "Healthy Sweets": "sweet", "Healthy Munchies": "munchies", "Gifting & Hampers": "hamper" } as const)[
    p.category as "Healthy Namkeen"
  ] ?? "namkeen";
}

const ip = (r: Rng) => `49.36.${r.int(1, 254)}.${r.int(1, 254)}`;
const UA = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 15; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
];

/** Writes in chunks: each round trip to the database is expensive. */
async function inChunks<T>(rows: T[], size: number, write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

/* ------------------------------------------------------------- the seed */

export async function generateDemo(db: PrismaClient, now = new Date(), seed = 20261014): Promise<DemoSummary> {
  const r = prng(seed);
  const id = (prefix: string) => `${prefix}_${r.token(22)}`;
  const uuid = () => `${r.token(8)}-${r.token(4)}-4${r.token(3)}-a${r.token(3)}-${r.token(12)}`;
  const start = at(now, -HISTORY_DAYS);

  /* ---------------------------------------------------- brands, categories */
  const brands = await db.brand.findMany({ include: { categories: true } });
  const brandBySlug = new Map(brands.map((b) => [b.slug, b]));
  if (!brandBySlug.has("the-true-store")) throw new Error("Base brands are missing: run prisma/seed.ts first.");
  // Customer-facing intros for the brand pages (demo copy).
  const INTROS: Record<string, { tagline: string; description: string }> = {
    "the-true-store": { tagline: "Gujarati snacks, made lighter", description: "Namkeen, sweets and munchies made the way Gujarati kitchens make them, roasted instead of fried wherever we can. Also on the shelves of our superstores in Ahmedabad, Surat and Vadodara." },
    "woman-axis": { tagline: "Daily gummies for women", description: "Vitamins, sleep, stress and cycle support in one-a-day gummies, with every nutrient and the sugar per gummy on the label." },
    "kids-vault": { tagline: "Vitamins kids look forward to", description: "Fruit-shaped, vegetarian gummies for growing children, with the age range and sugar per gummy printed on every pack." },
    "man-rituals": { tagline: "Simple daily rituals for men", description: "Vitality, multivitamin and hair-routine gummies for men, one or two a day, in flavours worth remembering." },
  };
  for (const [slug, intro] of Object.entries(INTROS)) {
    await db.brand.update({ where: { slug }, data: intro });
  }

  /* ----------------------------------------------------------------- staff */
  const staff = STAFF.map((s) => ({ ...s, id: id("adm") }));
  const byRole = (role: string) => staff.filter((s) => s.role === role);
  const manager = byRole("MANAGER")[0];
  const content = byRole("CONTENT")[0];
  const fulfilment = byRole("FULFILMENT");
  // Unusable passwords: a random value, hashed, never shown. These accounts
  // exist to populate the Team page; nobody can sign in as them.
  const { default: bcrypt } = await import("bcryptjs");
  const { randomBytes } = await import("node:crypto");
  const lockedHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 10);
  const { generateSecret } = await import("otplib");
  await db.adminUser.createMany({
    data: staff.map((s) => ({
      id: s.id, email: s.email, name: s.name, role: s.role, passwordHash: lockedHash, isActive: true,
      mfaSecret: generateSecret(), lastLoginAt: at(now, -r.int(0, 2), r.int(9, 19), r.int(0, 59)), createdAt: at(start, -20),
    })),
  });

  /* -------------------------------------------------------------- products */
  const products: ProductRow[] = [];
  for (const p of CATALOGUE) {
    const brand = brandBySlug.get(p.brand)!;
    const category = brand.categories.find((c) => c.name === p.category);
    if (!category) throw new Error(`Category "${p.category}" is missing for ${brand.name}.`);
    const maker = MAKERS[p.brand];
    const input = {
      sku: p.sku, name: p.name, slug: p.slug, brandId: brand.id, categoryId: category.id, regulatoryType: p.type,
      shortDescription: p.short, description: p.description, basePrice: String(p.price),
      discountActive: Boolean(p.discountPercent), discountPercent: p.discountPercent, hsnCode: p.hsn,
      taxRatePercent: p.tax, lowStockThreshold: 10, weightGrams: p.weightGrams, availableInRetail: Boolean(p.availableInRetail),
      retailOnly: false, isActive: true, isVeg: p.isVeg, shelfLifeDays: p.shelfLifeDays, allergens: p.allergens,
      suitableFromAge: p.ages?.[0], suitableToAge: p.ages?.[1], manufacturerName: maker.name,
      manufacturerAddress: maker.address, countryOfOrigin: "India", netQuantity: p.netQuantity, mrp: String(p.mrp),
      ingredients: p.ingredients,
      ...(p.type === "PACKAGED_FOOD"
        ? { nutritionFacts: p.nutrition }
        : {
            servingsPerContainer: p.supplement!.servings, sugarPerServingG: p.supplement!.sugarG,
            dosageGuidance: p.supplement!.dosage, supplementFacts: p.supplement!.facts, complianceReviewConfirmed: true,
          }),
    };
    const checked = productInputSchema.safeParse(input);
    if (!checked.success) {
      throw new Error(`Demo product ${p.sku} fails the app's own validation: ${checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    const listPaise = p.price * 100;
    const unitPaise = resolveUnitPrice(listPaise, { active: Boolean(p.discountPercent), percent: p.discountPercent ?? null }).pricePaise;
    products.push({ ...p, id: id("prd"), brandId: brand.id, categoryId: category.id, unitPaise, listPaise });
  }
  const createdAt = at(start, -12);
  await db.product.createMany({
    data: products.map((p) => ({
      id: p.id, sku: p.sku, name: p.name, slug: p.slug, brandId: p.brandId, categoryId: p.categoryId, regulatoryType: p.type,
      shortDescription: p.short, description: p.description, basePrice: String(p.price), mrp: String(p.mrp),
      discountActive: Boolean(p.discountPercent), discountPercent: p.discountPercent ?? null, hsnCode: p.hsn,
      taxRatePercent: p.tax, lowStockThreshold: 10, weightGrams: p.weightGrams, isActive: true,
      isFeatured: Boolean(p.featured), availableInRetail: Boolean(p.availableInRetail), retailOnly: false, isVeg: p.isVeg,
      allergens: p.allergens, shelfLifeDays: p.shelfLifeDays,
      nutritionFacts: (p.nutrition ?? undefined) as Prisma.InputJsonValue | undefined,
      servingsPerContainer: p.supplement?.servings ?? null, dosageGuidance: p.supplement?.dosage ?? null,
      supplementFacts: (p.supplement?.facts ?? undefined) as Prisma.InputJsonValue | undefined,
      sugarPerServingG: p.supplement ? String(p.supplement.sugarG) : null,
      suitableFromAge: p.ages?.[0] ?? null, suitableToAge: p.ages?.[1] ?? null,
      complianceReviewedAt: p.type === "HEALTH_SUPPLEMENT" ? at(createdAt, 2, 16) : null,
      complianceReviewedBy: p.type === "HEALTH_SUPPLEMENT" ? content.email : null,
      manufacturerName: MAKERS[p.brand].name, manufacturerAddress: MAKERS[p.brand].address,
      packerDetails: `Marketed by SooulOne, Ahmedabad, Gujarat`, countryOfOrigin: "India", netQuantity: p.netQuantity,
      ingredients: p.ingredients, metaTitle: `${p.name} | SooulOne`, metaDescription: p.short, createdAt,
    })),
  });
  await db.productImage.createMany({
    data: products.map((p) => ({ id: id("img"), productId: p.id, url: `/demo-assets/${p.slug}.svg`, altText: `${p.name}, ${p.netQuantity}`, sortOrder: 0, isPrimary: true })),
  });

  /* ------------------------------------------------ batches (quantities later) */
  // A production history per product: a new batch every few weeks (snacks) or
  // months (gummies), reaching back before the order history starts. Older
  // batches are sold out; stock sits only in batches that can still legally
  // ship (food needs max(30% of shelf life, 45 days) left at delivery), except
  // on the one product whose older batch is deliberately about to cross that
  // line, which lights up the dashboard's expiry warning.
  const batches: BatchPlan[] = [];
  const batchesOf = new Map<string, BatchPlan[]>();
  for (const p of products) {
    const s = p.shelfLifeDays;
    const food = p.type !== "HEALTH_SUPPLEMENT";
    const interval = food ? 45 : 120;
    const minLeft = food ? Math.max(Math.ceil(s * 0.3), 45) : 0;
    const code = p.sku.split("-").slice(1).join("");
    const mfgDates: Date[] = [at(now, -(s <= 120 ? r.int(4, 10) : r.int(18, 34)), 10)];
    const second = p.stock === "nearExpiry" ? at(now, -(s - 58), 10) : at(mfgDates[0], -interval, 10);
    mfgDates.push(second);
    while (mfgDates[mfgDates.length - 1] > at(start, -10)) mfgDates.push(at(mfgDates[mfgDates.length - 1], -interval, 10));
    const plans: BatchPlan[] = mfgDates
      .reverse()
      .map((mfg, i) => ({
        id: id("bat"), productId: p.id, number: `${code}-${mfg.toISOString().slice(2, 7).replace("-", "")}-${String.fromCharCode(65 + i)}`,
        mfg, exp: at(mfg, s), arrival: at(mfg, food ? 3 : 6), sold: 0, remaining: 0,
      }));
    // What's left today, by the product's stock story.
    const newest = plans[plans.length - 1];
    const previous = plans[plans.length - 2];
    const daysLeft = (b: BatchPlan) => (b.exp.getTime() - now.getTime()) / DAY;
    newest.remaining = { healthy: r.int(60, 160), low: r.int(4, 8), out: 0, nearExpiry: r.int(50, 90) }[p.stock];
    if (p.stock === "nearExpiry") previous.remaining = r.int(14, 26);
    else if (p.stock === "healthy" && daysLeft(previous) > minLeft + 30) previous.remaining = r.int(6, 24);
    batches.push(...plans);
    batchesOf.set(p.id, plans);
  }

  /* ------------------------------------------------------- stores, offers */
  await db.storeLocation.createMany({ data: STORES.map((s) => ({ ...s, id: id("sto"), isActive: true, createdAt: at(start, -40) })) });

  const tts = products.filter((p) => p.brand === "the-true-store");
  const bundleDefs = [
    // Descriptions add to the offer line the product page writes itself ("Any 2 of…: 10% off").
    { name: "Namkeen Trio", brand: "the-true-store", desc: "Stock the tea-time tin with three favourites.", min: 3, type: "PERCENTAGE" as const, value: 10, items: tts.filter((p) => p.category === "Healthy Namkeen") },
    { name: "Sweet Pair", brand: "the-true-store", desc: "No refined sugar in any of them.", min: 2, type: "FLAT" as const, value: 50, items: tts.filter((p) => p.category === "Healthy Sweets") },
    { name: "Woman Axis Daily Routine", brand: "woman-axis", desc: "Build your own two-step routine.", min: 2, type: "PERCENTAGE" as const, value: 15, items: products.filter((p) => p.brand === "woman-axis") },
    { name: "Kids Vault Growing-Up Kit", brand: "kids-vault", desc: "Mix any two for the school term.", min: 2, type: "PERCENTAGE" as const, value: 12, items: products.filter((p) => p.brand === "kids-vault") },
    // A fixed combo: every product required. A flat amount keeps the combo price round (₹898 → ₹799).
    { name: "Kids Immunity Duo", brand: "kids-vault", desc: "Daily multivitamin plus vitamin C and zinc.", min: 2, type: "FLAT" as const, value: 99, items: products.filter((p) => ["kids-daily-multivitamin", "vitamin-c-zinc-kids-gummies"].includes(p.slug)) },
  ].map((b) => ({ ...b, id: id("bun") }));
  for (const b of bundleDefs) {
    await db.bundle.create({
      data: {
        id: b.id, brandId: brandBySlug.get(b.brand)!.id, slug: `${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-demo`, name: b.name,
        description: b.desc, minItems: b.min, discountType: b.type, discountValue: String(b.value), isActive: true, createdAt: at(start, 6),
        eligibleProducts: { create: b.items.map((p) => ({ id: id("bep"), productId: p.id })) },
      },
    });
  }
  const bundleRules: BundleRule[] = bundleDefs.map((b) => ({ id: b.id, name: b.name, minItems: b.min, discountType: b.type, discountValue: b.value, eligibleProductIds: b.items.map((p) => p.id) }));

  const coupons = [
    { code: "WELCOME10", type: "PERCENTAGE" as const, value: 10, min: 499, maxUses: null, from: at(start, -5), until: at(now, 120), active: true, firstOrderOnly: true },
    { code: "GUJARAT150", type: "FLAT" as const, value: 150, min: 999, maxUses: 500, from: at(start, 20), until: at(now, 60), active: true, firstOrderOnly: false },
    { code: "RAKHI20", type: "PERCENTAGE" as const, value: 20, min: 799, maxUses: 300, from: at(new Date("2026-08-18T00:00:00+05:30"), 0), until: new Date("2026-08-29T23:59:59+05:30"), active: true, firstOrderOnly: false },
    { code: "NAVRATRI15", type: "PERCENTAGE" as const, value: 15, min: 599, maxUses: 1000, from: new Date("2026-10-10T00:00:00+05:30"), until: new Date("2026-10-25T23:59:59+05:30"), active: true, firstOrderOnly: false },
    { code: "SORRY100", type: "FLAT" as const, value: 100, min: 499, maxUses: 50, from: at(start, 30), until: at(now, 30), active: false, firstOrderOnly: false },
  ];
  const couponUses = new Map<string, number>();

  /* ------------------------------------------------------------- shoppers */
  type Shopper = { name: string; email: string; phone: string; city: (typeof CITIES)[number]; address: Record<string, string>; orders: number };
  const shoppers: Shopper[] = [];
  const usedEmails = new Set<string>();
  const newShopper = (): Shopper => {
    const female = r.chance(0.62); // women over-index for this catalogue
    const first = r.pick(female ? FIRST_NAMES_F : FIRST_NAMES_M);
    const last = r.pick(LAST_NAMES);
    let email = "";
    do {
      const style = r.int(0, 3);
      const local = [`${first}.${last}`, `${first}${last}${r.int(1, 99)}`, `${first}_${r.int(1980, 2004)}`, `${first[0]}${last}${r.int(10, 999)}`][style];
      email = `${local.toLowerCase()}@${r.weighted(EMAIL_DOMAINS)}`;
    } while (usedEmails.has(email));
    usedEmails.add(email);
    const city = r.weighted(CITIES.map((c) => [c, c.weight] as const));
    const pin = String(r.int(city.pins[0], city.pins[1]));
    const area = r.pick(city.areas);
    const flat = `${r.pick(["A", "B", "C", "D"])}-${r.int(1, 14)}0${r.int(1, 4)}`;
    return {
      name: `${first} ${last}`, email, phone: `${r.pick(["9", "8", "7", "6"])}${r.int(100000000, 999999999)}`, city, orders: 0,
      address: {
        name: `${first} ${last}`, line1: `${flat}, ${r.pick(BUILDING_WORDS)} ${r.pick(BUILDING_KINDS)}`, line2: area,
        city: city.city, state: "Gujarat", postalCode: pin, country: "IN", phone: "",
      },
    };
  };

  /* ---------------------------------------------------------------- orders */
  type OrderPlan = {
    id: string; number: string; token: string; sessionId: string; shopper: Shopper; placedAt: Date; cod: boolean;
    method: "COD" | "UPI" | "CARD" | "NETBANKING"; status: string; shippedAt?: Date; deliveredAt?: Date; closedAt?: Date;
    closeReason?: string; courier?: string; awb?: string; promised: Date; quote: ReturnType<typeof buildQuote>;
    lines: { product: ProductRow; quantity: number }[]; consent: boolean; note?: string; invoice?: string; paymentId?: string;
  };
  const orders: OrderPlan[] = [];
  const pickProduct = (festive: boolean) =>
    r.weighted(products.filter((p) => p.stock !== "out" || r.chance(0.3)).map((p) => [p, p.popularity * (festive && (p.category === "Gifting & Hampers" || p.category === "Healthy Sweets") ? 3 : 1)] as const));

  for (let d = HISTORY_DAYS; d >= 0; d--) {
    const day = at(now, -d);
    const ist = new Date(day.getTime() + 5.5 * 3600 * 1000);
    const weekend = [0, 6].includes(ist.getUTCDay());
    const festive = ist.getUTCMonth() === 7 && ist.getUTCDate() >= 18 && ist.getUTCDate() <= 28; // Raksha Bandhan run-up
    const expected = (1.3 + (HISTORY_DAYS - d) * 0.047) * (weekend ? 1.25 : 1) * (festive ? 1.9 : 1);
    const count = Math.max(0, Math.round(expected + (r.next() - 0.5) * 2.2));
    for (let k = 0; k < count; k++) {
      const hour = r.weighted([[9, 2], [10, 3], [11, 4], [12, 6], [13, 7], [14, 5], [15, 4], [16, 4], [17, 5], [18, 6], [19, 7], [20, 9], [21, 10], [22, 8], [23, 4]] as const);
      const placedAt = at(day, 0, hour, r.int(0, 59));
      if (placedAt > now) continue;

      // A quarter of orders come from people who've bought before.
      const regulars = shoppers.filter((s) => s.orders < 4);
      const returning = regulars.length > 20 && r.chance(0.26);
      const shopper = returning ? r.pick(regulars) : newShopper();
      if (!returning) shoppers.push(shopper);

      const lines = new Map<string, { product: ProductRow; quantity: number }>();
      const corporate = r.chance(0.005);
      if (corporate) {
        const crate = products.find((p) => p.slug === "corporate-wellness-crate")!;
        lines.set(crate.id, { product: crate, quantity: r.int(3, 8) });
      } else {
        const size = r.weighted([[1, 38], [2, 34], [3, 18], [4, 10]] as const);
        for (let i = 0; i < size; i++) {
          const p = pickProduct(festive);
          const existing = lines.get(p.id);
          if (existing) existing.quantity = Math.min(3, existing.quantity + 1);
          else lines.set(p.id, { product: p, quantity: r.weighted([[1, 80], [2, 16], [3, 4]] as const) });
        }
      }
      const lineList = [...lines.values()];

      const cod = r.chance(corporate ? 0.1 : 0.52);
      const method = cod ? "COD" : r.weighted([["UPI", 70], ["CARD", 22], ["NETBANKING", 8]] as const);

      // Coupon, if one was live and the shopper would plausibly have it.
      const live = coupons.filter((c) => c.active && placedAt >= c.from && placedAt <= c.until && (!c.firstOrderOnly || shopper.orders === 0));
      const coupon = r.chance(0.2) && live.length ? r.pick(live) : null;
      const quoteLines: QuoteLineInput[] = lineList.map(({ product: p, quantity }) => ({
        productId: p.id, name: p.name, regulatoryType: p.type, unitPricePaise: p.unitPaise, listPricePaise: p.listPaise,
        quantity, taxRatePercent: p.tax, shelfLifeDays: p.shelfLifeDays, stockQuantity: 100_000, active: true,
      }));
      const quote = buildQuote({
        lines: quoteLines, estimatedDeliveryDate: at(placedAt, 3), gstTreatment: "INTRA_STATE",
        coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value, minOrderPaise: coupon.min * 100 } : undefined,
        bundles: bundleRules,
      });

      // Where the order got to by now.
      const age = (now.getTime() - placedAt.getTime()) / DAY;
      let status = cod ? "PROCESSING" : "PAID";
      let shippedAt: Date | undefined, deliveredAt: Date | undefined, closedAt: Date | undefined, closeReason: string | undefined;
      const near = ["Ahmedabad", "Gandhinagar"].includes(shopper.city.city);
      const promised = at(placedAt, near ? 2 : 3);
      if (!cod && r.chance(0.03)) {
        status = "FAILED";
      } else if (age > 0.3 && r.chance(0.04)) {
        status = "CANCELLED";
        closedAt = new Date(placedAt.getTime() + r.int(2, 18) * 3600 * 1000);
        closeReason = cod ? r.weighted([["UNCONFIRMED_COD", 5], ["CUSTOMER_REQUEST", 4], ["OUT_OF_STOCK", 1]] as const) : r.weighted([["CUSTOMER_REQUEST", 8], ["OUT_OF_STOCK", 2]] as const);
      } else {
        // Dispatched with the afternoon courier pickup on the next working
        // day (no Sunday pickups), so yesterday's and today's orders are
        // still in the packing queue for most of the day.
        let ship = at(placedAt, 1, r.int(15, 18), r.int(0, 59));
        if (new Date(ship.getTime() + 5.5 * 3600 * 1000).getUTCDay() === 0) ship = at(ship, 1);
        if (ship <= now && age > 0.25) {
          shippedAt = ship;
          status = "SHIPPED";
          const transit = (near ? r.int(1, 2) : r.int(2, 3)) + (r.chance(0.08) ? 2 : 0);
          const arrives = at(ship, transit, r.int(11, 19), r.int(0, 59));
          if (cod && r.chance(0.055)) {
            const back = at(ship, r.int(6, 9), 15);
            if (back <= now) {
              status = "RTO";
              closedAt = back;
              closeReason = r.weighted([["REFUSED_AT_DOOR", 5], ["UNREACHABLE", 3], ["ADDRESS_ISSUE", 2]] as const);
            }
          } else if (arrives <= now) {
            status = "DELIVERED";
            deliveredAt = arrives;
            const returnAt = at(arrives, r.int(3, 7), 14);
            if (r.chance(0.018) && returnAt <= now) {
              status = "RETURNED";
              closedAt = returnAt;
              closeReason = r.weighted([["DAMAGED", 4], ["QUALITY", 3], ["WRONG_ITEM", 2]] as const);
            }
          }
        }
      }
      const courier = shippedAt ? r.weighted(COURIERS.map((c) => [c, c.weight] as const)) : undefined;

      shopper.orders += 1;
      shopper.address.phone = shopper.phone;
      if (quote.appliedCouponCode && status !== "CANCELLED" && status !== "FAILED") {
        couponUses.set(quote.appliedCouponCode, (couponUses.get(quote.appliedCouponCode) ?? 0) + 1);
      }
      const stamp = placedAt.getTime().toString(36).toUpperCase();
      orders.push({
        id: id("ord"), number: `SO-${stamp}-${r.int(0, 1295).toString(36).toUpperCase().padStart(2, "0")}`,
        token: r.token(32), sessionId: uuid(), shopper, placedAt, cod, method, status, shippedAt, deliveredAt, closedAt,
        closeReason, courier: courier?.name, awb: courier?.awb(r.next), promised, quote, lines: lineList,
        consent: r.chance(0.34), note: r.chance(0.06) ? (cod && r.chance(0.4) ? COD_NOTE : r.pick(ORDER_NOTES)) : undefined,
        paymentId: cod ? undefined : `order_${r.token(14)}`,
      });
    }
  }

  // GST invoices: consecutive, in the order parcels left.
  const shippedOrders = orders.filter((o) => o.shippedAt).sort((a, b) => a.shippedAt!.getTime() - b.shippedAt!.getTime());
  const invoiceCount = new Map<string, number>();
  for (const o of shippedOrders) {
    const fy = financialYear(o.shippedAt!);
    const n = (invoiceCount.get(fy) ?? 0) + 1;
    invoiceCount.set(fy, n);
    o.invoice = formatInvoiceNumber(fy, n);
  }

  /* --------------------------------------------- stock: batches drawn FEFO */
  const takesStock = (o: OrderPlan) => o.status !== "CANCELLED" && o.status !== "FAILED";
  const allocationOf = new Map<string, { batchId: string; quantity: number }[]>(); // key: orderId|productId
  for (const o of [...orders].sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime())) {
    for (const line of o.lines) {
      const plans = batchesOf.get(line.product.id)!;
      // First expiry, first out: the older of the two latest batches that had
      // arrived by then, moving to the newer one as the older runs down.
      const food = line.product.type !== "HEALTH_SUPPLEMENT";
      const minLeft = food ? Math.max(Math.ceil(line.product.shelfLifeDays * 0.3), 45) : 0;
      const arrived = plans.filter((b) => b.arrival <= o.placedAt && (b.exp.getTime() - o.placedAt.getTime()) / DAY >= minLeft + 3);
      const [older, newer] = arrived.slice(-2);
      const batch = !newer ? older ?? plans[0] : r.chance(0.6) ? older : newer;
      allocationOf.set(`${o.id}|${line.product.id}`, [{ batchId: batch.id, quantity: line.quantity }]);
      if (takesStock(o)) batch.sold += line.quantity;
    }
  }
  await db.productBatch.createMany({
    data: batches.map((b) => ({
      id: b.id, productId: b.productId, batchNumber: b.number, manufacturedOn: b.mfg, expiresOn: b.exp,
      // Batches that arrived before the 90-day history also sold units before
      // it; the database requires every batch to have received something.
      quantityReceived: b.sold + b.remaining + (b.arrival < start || b.sold + b.remaining === 0 ? r.int(30, 120) : 0),
      quantityRemaining: b.remaining, createdAt: b.arrival,
    })),
  });

  /* ----------------------------------------------------- write the orders */
  const orderRows: Prisma.OrderCreateManyInput[] = [];
  const itemRows: Prisma.OrderItemCreateManyInput[] = [];
  const eventRows: Prisma.OrderEventCreateManyInput[] = [];
  const auditRows: Prisma.AdminAuditLogCreateManyInput[] = [];
  const consentRows: Prisma.ConsentRecordCreateManyInput[] = [];
  // Nothing is dated in the future: a follow-up that would land after "now" is recorded as now.
  const notAfterNow = (d: Date) => (d > now ? now : d);
  const audit = (who: (typeof staff)[number], when: Date, action: string, entityType: string, entityId: string, changes?: unknown) =>
    auditRows.push({
      id: id("aud"), adminUserId: who.id, actorEmail: who.email, action, entityType, entityId,
      changes: (changes ?? undefined) as Prisma.InputJsonValue | undefined, ipAddress: ip(r), userAgent: r.pick(UA), createdAt: notAfterNow(when),
    });

  let revenuePaise = 0;
  for (const o of orders) {
    const { quote } = o;
    const address = o.shopper.address;
    const shippingTaxPaise = quote.taxPaise - quote.lines.reduce((s, l) => s + l.taxPaise, 0);
    const paid = !o.cod && o.status !== "FAILED";
    orderRows.push({
      id: o.id, orderNumber: o.number, accessToken: o.token, sessionId: o.sessionId, guestEmail: o.shopper.email,
      guestPhone: o.shopper.phone, status: o.status as Prisma.OrderCreateManyInput["status"],
      // The same values the app writes: COD_PENDING for cash on delivery, the
      // Razorpay webhook's "captured" / "failed" for online payments.
      paymentStatus: o.cod ? "COD_PENDING" : paid ? "captured" : "failed",
      subtotal: fromPaise(quote.subtotalPaise), productDiscountAmount: fromPaise(quote.productDiscountPaise),
      bundleDiscountAmount: fromPaise(quote.bundleDiscountPaise),
      bundleLabel: quote.appliedBundles.length ? quote.appliedBundles.map((b) => b.name).join(", ") : null,
      discountAmount: fromPaise(quote.discountPaise), shippingAmount: fromPaise(quote.shippingPaise),
      taxAmount: fromPaise(quote.taxPaise), totalAmount: fromPaise(quote.totalPaise), couponCode: quote.appliedCouponCode ?? null,
      shippingAddress: address, billingAddress: address, paymentGateway: o.cod ? "COD" : "RAZORPAY", paymentId: o.paymentId ?? null,
      trackingNumber: o.awb ?? null, courierPartner: o.courier ?? null, promisedDeliveryDate: o.promised,
      deliveredAt: o.deliveredAt ?? null, closedAt: o.closedAt ?? null, closeReason: o.closeReason ?? null,
      invoiceNumber: o.invoice ?? null, invoiceDate: o.invoice ? o.shippedAt! : null,
      shippingTaxAmount: fromPaise(shippingTaxPaise), gstTreatment: "INTRA_STATE", placedAt: o.placedAt, updatedAt: o.closedAt ?? o.deliveredAt ?? o.shippedAt ?? o.placedAt,
    });
    if (takesStock(o) && !["RTO", "RETURNED"].includes(o.status)) revenuePaise += quote.totalPaise;

    // Item rows exactly as create-order writes them.
    for (const line of quote.lines) {
      const allocations = allocationOf.get(`${o.id}|${line.productId}`)!;
      const weights = allocations.map((a) => a.quantity);
      const gross = apportion(line.grossPaise, weights);
      const taxable = apportion(line.taxablePaise, weights);
      const tax = apportion(line.taxPaise, weights);
      const product = products.find((p) => p.id === line.productId)!;
      allocations.forEach((a, i) =>
        itemRows.push({
          id: id("itm"), orderId: o.id, productId: line.productId, batchId: a.batchId, productNameSnapshot: line.name,
          unitPriceSnapshot: fromPaise(Math.round(line.grossPaise / Math.max(line.quantityAvailable, 1))),
          listUnitPriceSnapshot: fromPaise(Math.round(line.listGrossPaise / Math.max(line.quantityAvailable, 1))),
          quantity: a.quantity, lineTotal: fromPaise(gross[i]), hsnCode: product.hsn, taxRatePercent: line.taxRatePercent,
          taxableAmount: fromPaise(taxable[i]), taxAmount: fromPaise(tax[i]),
        }),
      );
    }

    // Timeline.
    const ev = (type: Prisma.OrderEventCreateManyInput["type"], when: Date, actorType: Prisma.OrderEventCreateManyInput["actorType"], actorEmail: string | null, detail?: unknown) =>
      eventRows.push({ id: id("evt"), orderId: o.id, type, actorType, actorEmail, detail: (detail ?? undefined) as Prisma.InputJsonValue | undefined, createdAt: notAfterNow(when) });
    const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);
    ev("PLACED", o.placedAt, "CUSTOMER", o.shopper.email, { method: o.cod ? "COD" : "RAZORPAY", totalPaise: quote.totalPaise });
    if (o.status === "FAILED") {
      ev("PAYMENT_FAILED", plus(o.placedAt, 3), "SYSTEM", null, { reason: r.pick(["Payment declined by bank", "UPI request expired", "Card authentication failed"]) });
    } else {
      if (!o.cod) ev("PAYMENT_CAPTURED", plus(o.placedAt, 1), "SYSTEM", null, { razorpayPaymentId: `pay_${r.token(14)}`, amountPaise: quote.totalPaise, method: o.method.toLowerCase() });
      ev("EMAIL_SENT", plus(o.placedAt, o.cod ? 0 : 1), "SYSTEM", null, { email: "order_confirmation", delivered: true, reason: null });
    }
    if (o.consent) {
      consentRows.push({ id: id("con"), purpose: "MARKETING", granted: true, email: o.shopper.email, phone: o.shopper.phone, noticeText: MARKETING_CONSENT_TEXT, source: "checkout", orderId: o.id, createdAt: o.placedAt });
    }
    if (o.note) {
      const when = plus(o.placedAt, r.int(20, 240));
      ev("NOTE", when, "ADMIN", manager.email, { note: o.note });
      audit(manager, when, "ADD_ORDER_NOTE", "Order", o.id, { note: o.note });
    }
    const from = o.cod ? "PROCESSING" : "PAID";
    if (o.status === "CANCELLED") {
      const changes = { status: { from, to: "CANCELLED" }, closeReason: { from: null, to: o.closeReason } };
      ev("STATUS_CHANGED", o.closedAt!, "ADMIN", manager.email, changes);
      audit(manager, o.closedAt!, "SET_ORDER_STATUS", "Order", o.id, changes);
    }
    if (o.shippedAt) {
      const packer = r.pick(fulfilment);
      const changes = { status: { from, to: "SHIPPED" }, trackingNumber: { from: null, to: o.awb }, courierPartner: { from: null, to: o.courier } };
      ev("STATUS_CHANGED", o.shippedAt, "ADMIN", packer.email, changes);
      audit(packer, o.shippedAt, "SET_ORDER_STATUS", "Order", o.id, changes);
      ev("EMAIL_SENT", plus(o.shippedAt, 0), "SYSTEM", null, { email: "shipping_notification", delivered: true, reason: null });
      const closing = o.status === "RTO" ? o.closedAt! : o.deliveredAt;
      if (closing) {
        const who = r.pick(fulfilment);
        const to = o.status === "RTO" ? "RTO" : "DELIVERED";
        const change = { status: { from: "SHIPPED", to }, ...(to === "RTO" ? { closeReason: { from: null, to: o.closeReason } } : {}) };
        ev("STATUS_CHANGED", plus(closing, r.int(30, 300)), "ADMIN", who.email, change);
        audit(who, plus(closing, r.int(30, 300)), "SET_ORDER_STATUS", "Order", o.id, change);
      }
      if (o.status === "RETURNED") {
        const change = { status: { from: "DELIVERED", to: "RETURNED" }, closeReason: { from: null, to: o.closeReason } };
        ev("STATUS_CHANGED", o.closedAt!, "ADMIN", manager.email, change);
        audit(manager, o.closedAt!, "SET_ORDER_STATUS", "Order", o.id, change);
      }
    }
  }
  await inChunks(orderRows, 500, (c) => db.order.createMany({ data: c }));
  await inChunks(itemRows, 1000, (c) => db.orderItem.createMany({ data: c }));
  await inChunks(eventRows, 2000, (c) => db.orderEvent.createMany({ data: c }));
  await inChunks(consentRows, 1000, (c) => db.consentRecord.createMany({ data: c }));

  for (const c of coupons) {
    await db.coupon.create({
      data: { id: id("cpn"), code: c.code, discountType: c.type, discountValue: String(c.value), minOrderValue: String(c.min), maxUses: c.maxUses, usedCount: couponUses.get(c.code) ?? 0, validFrom: c.from, validUntil: c.until, isActive: c.active },
    });
  }
  for (const [fy, n] of invoiceCount) await db.invoiceSequence.create({ data: { financialYear: fy, lastNumber: n } });

  /* --------------------------------------------------------------- reviews */
  const reviewRows: Prisma.ReviewCreateManyInput[] = [];
  const usedText = new Map<string, Set<string>>();
  for (const o of orders.filter((x) => x.status === "DELIVERED")) {
    if (!r.chance(0.36)) continue;
    const line = r.pick(o.lines);
    const pool = REVIEWS[kindOf(line.product)];
    const used = usedText.get(line.product.id) ?? new Set<string>();
    const options = pool.filter((x) => !used.has(x.text) && (!x.only || x.only.includes(line.product.slug)));
    if (!options.length) continue;
    const { rating, text: comment } = r.pick(options);
    used.add(comment);
    usedText.set(line.product.id, used);
    const createdAt = at(o.deliveredAt!, r.int(1, 9), r.int(8, 23), r.int(0, 59));
    if (createdAt > now) continue;
    const [first, last] = o.shopper.name.split(" ");
    const reviewId = id("rev");
    reviewRows.push({ id: reviewId, productId: line.product.id, customerName: `${first} ${last[0]}.`, rating, comment, isApproved: true, createdAt });
    audit(content, at(createdAt, 0.3 + r.next()), "REVIEW_APPROVE", "Review", reviewId);
  }
  for (const p of PENDING_REVIEWS) {
    const product = products.find((x) => x.slug === p.slug);
    if (!product) throw new Error(`Pending review points at unknown product ${p.slug}`);
    const first = r.pick([...FIRST_NAMES_F, ...FIRST_NAMES_M]);
    reviewRows.push({ id: id("rev"), productId: product.id, customerName: `${first} ${r.pick(LAST_NAMES)[0]}.`, rating: p.rating, comment: p.text, isApproved: false, createdAt: at(now, -r.next() * 2.5) });
  }
  await db.review.createMany({ data: reviewRows });

  /* ------------------------------------------------------------- analytics */
  const events: Prisma.AnalyticsEventCreateManyInput[] = [];
  const e = (sessionId: string, type: Prisma.AnalyticsEventCreateManyInput["type"], createdAt: Date, extra: { productId?: string; orderId?: string; metadata?: unknown } = {}) =>
    events.push({ id: id("ane"), sessionId, type, createdAt, productId: extra.productId ?? null, orderId: extra.orderId ?? null, metadata: (extra.metadata ?? undefined) as Prisma.InputJsonValue | undefined });
  const paths = ["/", "/", "/", "/true-store", "/gummies", "/gummies/woman-axis", "/gummies/kids-vault", "/gummies/man-rituals"];
  const minus = (d: Date, minutes: number) => new Date(d.getTime() - minutes * 60_000);

  for (const o of orders) {
    const s = o.sessionId;
    const t0 = minus(o.placedAt, r.int(9, 28));
    e(s, "VISIT", t0, { metadata: { path: r.chance(0.4) ? `/product/${o.lines[0].product.slug}` : r.pick(paths) } });
    o.lines.forEach((l, i) => {
      e(s, "PRODUCT_VIEW", minus(o.placedAt, 8 - i), { productId: l.product.id });
      e(s, "ADD_TO_CART", minus(o.placedAt, 7 - i), { productId: l.product.id });
    });
    e(s, "CART_OPENED", minus(o.placedAt, 5));
    if (o.quote.shippingPaise > 0) e(s, "OFFER_SHOWN", minus(o.placedAt, 5), { metadata: { offer: "free_delivery" } });
    for (const b of o.quote.appliedBundles) e(s, "OFFER_APPLIED", minus(o.placedAt, 5), { metadata: { offer: "bundle", offerId: b.id } });
    e(s, "CHECKOUT_STARTED", minus(o.placedAt, 4));
    e(s, "CHECKOUT_STEP", minus(o.placedAt, 4), { metadata: { step: "contact" } });
    e(s, "CHECKOUT_STEP", minus(o.placedAt, 3), { metadata: { step: "address" } });
    e(s, "CHECKOUT_STEP", minus(o.placedAt, 2), { metadata: { step: "payment" } });
    e(s, "PAYMENT_METHOD_SELECTED", minus(o.placedAt, 1), { metadata: { method: o.method === "NETBANKING" ? "RAZORPAY" : o.method } });
    e(s, "ORDER_PLACED", o.placedAt, { orderId: o.id, metadata: { totalPaise: o.quote.totalPaise, method: o.cod ? "COD" : "RAZORPAY" } });
    if (o.status !== "FAILED") e(s, "ORDER_PAID", new Date(o.placedAt.getTime() + 60_000), { orderId: o.id, metadata: { totalPaise: o.quote.totalPaise, method: o.cod ? "COD" : "RAZORPAY" } });
  }

  // Everyone who browsed and didn't buy, sized so ~2.4% of sessions convert.
  let sessions = orders.length;
  for (let d = HISTORY_DAYS; d >= 0; d--) {
    const day = at(now, -d);
    const dayOrders = orders.filter((o) => o.placedAt >= day && o.placedAt < at(day, 1)).length;
    const browsing = Math.round(Math.max(40, dayOrders / CONVERSION) * (0.9 + r.next() * 0.2)) - dayOrders;
    for (let k = 0; k < browsing; k++) {
      const t = at(day, 0, r.weighted([[9, 3], [11, 5], [13, 7], [15, 5], [17, 6], [19, 8], [21, 10], [22, 7], [23, 3]] as const), r.int(0, 59));
      if (t > now) continue;
      sessions++;
      const s = uuid();
      e(s, "VISIT", t, { metadata: { path: r.pick(paths) } });
      if (!r.chance(0.58)) continue;
      const viewed = [pickProduct(false), ...(r.chance(0.4) ? [pickProduct(false)] : [])];
      viewed.forEach((p, i) => e(s, "PRODUCT_VIEW", new Date(t.getTime() + (i + 1) * 60_000), { productId: p.id }));
      if (!r.chance(0.13)) continue;
      e(s, "ADD_TO_CART", new Date(t.getTime() + 3 * 60_000), { productId: viewed[0].id });
      if (r.chance(0.6)) e(s, "CART_OPENED", new Date(t.getTime() + 4 * 60_000));
      if (r.chance(0.35)) e(s, "OFFER_SHOWN", new Date(t.getTime() + 4 * 60_000), { metadata: { offer: "free_delivery" } });
      if (!r.chance(0.42)) continue;
      e(s, "CHECKOUT_STARTED", new Date(t.getTime() + 5 * 60_000));
      e(s, "CHECKOUT_STEP", new Date(t.getTime() + 5 * 60_000), { metadata: { step: "contact" } });
      if (r.chance(0.55)) e(s, "CHECKOUT_STEP", new Date(t.getTime() + 6 * 60_000), { metadata: { step: "address" } });
      if (r.chance(0.3)) e(s, "CHECKOUT_STEP", new Date(t.getTime() + 7 * 60_000), { metadata: { step: "payment" } });
    }
  }
  await inChunks(events, 5000, (c) => db.analyticsEvent.createMany({ data: c }));

  /* ------------------------------------------------ activity log, settings */
  for (const p of products) audit(r.chance(0.5) ? content : manager, at(createdAt, r.next() * 3, r.int(10, 18)), "CREATE_PRODUCT", "Product", p.id, { name: p.name, sku: p.sku });
  for (const b of batches.filter((x) => x.number.endsWith("-B"))) {
    audit(r.pick(fulfilment), b.arrival, "ADD_BATCH", "ProductBatch", b.id, { productId: b.productId, batchNumber: b.number, quantity: b.sold + b.remaining });
  }
  for (const b of bundleDefs) audit(manager, at(start, 6, 12), "CREATE_BUNDLE", "Bundle", b.id, { name: b.name });
  for (const c of coupons) audit(manager, at(c.from, 0, 11), "CREATE_COUPON", "Coupon", c.code, { code: c.code, discountType: c.type, discountValue: c.value });
  for (let d = 30; d >= 0; d--) {
    for (const s of staff.filter((x) => x.role !== "STAFF")) {
      if (r.chance(0.7)) audit(s, at(now, -d, r.int(9, 11), r.int(0, 59)), "SIGN_IN", "AdminUser", s.id);
    }
  }
  const auditInRange = auditRows;
  await inChunks(auditInRange, 2000, (c) => db.adminAuditLog.createMany({ data: c }));

  await db.businessProfile.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default", legalName: "SooulOne Consumer Brands Private Limited", tradeName: "SooulOne",
      registeredAddress: "4th Floor, Parishram Business Park, Sindhu Bhavan Road, Bodakdev, Ahmedabad, Gujarat 380054",
      // Demo-only: the check character is deliberately wrong, so this can't be anyone's real GSTIN.
      gstin: "24AAKCS4821M1ZX", fssaiLicence: "10726001000417", customerCarePhone: "+91 79 4890 2200",
      customerCareEmail: "care@sooulone.in", grievanceOfficerName: "Kavita Shah", grievanceOfficerDesignation: "Grievance Officer",
      grievanceOfficerPhone: "+91 79 4890 2201", grievanceOfficerEmail: "grievance@sooulone.in",
    },
  });
  await db.storeSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });

  return {
    products: products.length, batches: batches.length, orders: orders.length, orderItems: itemRows.length,
    orderEvents: eventRows.length, reviews: reviewRows.filter((x) => x.isApproved).length,
    pendingReviews: reviewRows.filter((x) => !x.isApproved).length, analyticsEvents: events.length, sessions,
    auditRows: auditInRange.length, invoices: shippedOrders.length, revenuePaise, staff: staff.length,
  };
}
