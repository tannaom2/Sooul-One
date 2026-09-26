/**
 * The demo catalogue: 34 products across the four brands.
 *
 * ILLUSTRATIVE ONLY. Nutrition panels, supplement facts, dosages, ingredients,
 * HSN codes and GST rates here are plausible, not formulation records. They
 * exist to make the demo look complete and must never be copied into a real
 * listing (prisma/seed.ts explains why real SKUs aren't seeded). They live
 * only in the throwaway demo database.
 *
 * Every entry is run through the app's own productInputSchema (including the
 * supplement claims check) before it's written, so the demo can't show a
 * product the admin form would have refused.
 */

export type StockPlan = "healthy" | "low" | "out" | "nearExpiry";

export interface Nutrition {
  energyKcal: number; proteinG: number; carbohydrateG: number; totalSugarsG: number; totalFatG: number;
  saturatedFatG: number; transFatG: number; sodiumMg: number; fibreG: number; servingSizeG: number;
}

export interface DemoProduct {
  brand: "the-true-store" | "woman-axis" | "kids-vault" | "man-rituals";
  category: string;
  sku: string;
  name: string;
  slug: string;
  type: "PACKAGED_FOOD" | "HEALTH_SUPPLEMENT";
  short: string;
  description: string;
  price: number;
  mrp: number;
  discountPercent?: number;
  hsn: string;
  tax: number;
  shelfLifeDays: number;
  isVeg: boolean;
  allergens: string[];
  netQuantity: string;
  weightGrams: number;
  ingredients: string;
  nutrition?: Nutrition;
  supplement?: {
    servings: number;
    dosage: string;
    sugarG: number;
    facts: { ingredient: string; amountPerServing: string; percentRDA: number | null }[];
  };
  ages?: [number, number];
  featured?: boolean;
  availableInRetail?: boolean;
  stock: StockPlan;
  /** Relative sales weight: how often this appears in orders. */
  popularity: number;
}

const n = (
  energyKcal: number, proteinG: number, carbohydrateG: number, totalSugarsG: number, totalFatG: number,
  saturatedFatG: number, sodiumMg: number, fibreG: number, servingSizeG = 30,
): Nutrition => ({ energyKcal, proteinG, carbohydrateG, totalSugarsG, totalFatG, saturatedFatG, transFatG: 0, sodiumMg, fibreG, servingSizeG });

const DAILY = "Do not exceed the recommended daily intake. Not a substitute for a varied, balanced diet.";

export const CATALOGUE: DemoProduct[] = [
  /* ------------------------------------------------ The True Store: namkeen */
  {
    brand: "the-true-store", category: "Healthy Namkeen", sku: "TTS-NMK-001", name: "Roasted Masala Makhana",
    slug: "roasted-masala-makhana", type: "PACKAGED_FOOD",
    short: "Fox nuts slow-roasted in cold-pressed groundnut oil with a warm house masala.",
    description:
      "Whole makhana from Bihar, roasted in small batches until they snap, then tossed in a masala of roasted cumin, Kashmiri chilli, amchur and black salt. Light enough for a mid-afternoon bowl, seasoned enough to stand in for your usual chevdo.\n\nRoasted, never fried. No palm oil, no added MSG.",
    price: 199, mrp: 199, hsn: "20081990", tax: 5, shelfLifeDays: 180, isVeg: true, allergens: ["May contain traces of peanuts"],
    netQuantity: "80 g", weightGrams: 95,
    ingredients: "Fox nuts (makhana) (82%), cold-pressed groundnut oil, spice mix (cumin, Kashmiri chilli, dry mango, coriander, black pepper), black salt, rock salt.",
    nutrition: n(118, 3.8, 18.2, 0.6, 3.4, 0.6, 196, 2.9), featured: true, availableInRetail: true, stock: "healthy", popularity: 10,
  },
  {
    brand: "the-true-store", category: "Healthy Namkeen", sku: "TTS-NMK-002", name: "Baked Ragi Chakli",
    slug: "baked-ragi-chakli", type: "PACKAGED_FOOD",
    short: "The Diwali classic, baked with finger millet and sesame instead of deep-fried.",
    description:
      "Our take on the spiral every Gujarati kitchen makes before Diwali: finger-millet and rice flour, white sesame, ajwain and a little green chilli, piped by hand and baked till crisp.\n\nAbout half the fat of a fried chakli, with all the crunch.",
    price: 149, mrp: 159, hsn: "21069099", tax: 5, shelfLifeDays: 150, isVeg: true, allergens: ["Sesame"],
    netQuantity: "150 g", weightGrams: 170,
    ingredients: "Finger millet flour (38%), rice flour, gram flour, cold-pressed groundnut oil, white sesame, green chilli, ajwain, turmeric, asafoetida, rock salt.",
    nutrition: n(139, 3.2, 20.4, 0.8, 4.9, 0.9, 212, 2.4), availableInRetail: true, stock: "nearExpiry", popularity: 6,
  },
  {
    brand: "the-true-store", category: "Healthy Namkeen", sku: "TTS-NMK-003", name: "Jowar Puffs, Peri-Peri",
    slug: "jowar-puffs-peri-peri", type: "PACKAGED_FOOD",
    short: "Airy sorghum puffs with a bright peri-peri dust. The one kids steal from the tiffin.",
    description:
      "Sorghum puffed under pressure, then seasoned with smoked paprika, bird's-eye chilli, garlic and a squeeze of lemon powder. Big flavour, 99 kcal a serving.",
    price: 99, mrp: 99, hsn: "19049000", tax: 5, shelfLifeDays: 180, isVeg: true, allergens: [],
    netQuantity: "60 g", weightGrams: 72,
    ingredients: "Sorghum (jowar) (78%), rice bran oil, peri-peri seasoning (paprika, chilli, garlic, onion, lemon powder, oregano), rock salt.",
    nutrition: n(99, 2.9, 17.6, 0.9, 2.1, 0.4, 184, 2.1, 25), stock: "healthy", popularity: 9,
  },
  {
    brand: "the-true-store", category: "Healthy Namkeen", sku: "TTS-NMK-004", name: "Methi Khakhra Crisps",
    slug: "methi-khakhra-crisps", type: "PACKAGED_FOOD",
    short: "Bite-size khakhra with kasuri methi, roasted on the tawa and broken into crisps.",
    description:
      "Whole-wheat khakhra rolled paper-thin with kasuri methi and a pinch of turmeric, roasted on a cast-iron tawa, then snapped into crisps you can dip. The tea-time staple, reshaped.",
    price: 129, mrp: 129, hsn: "19059040", tax: 5, shelfLifeDays: 150, isVeg: true, allergens: ["Wheat (gluten)"],
    netQuantity: "180 g", weightGrams: 200,
    ingredients: "Whole wheat flour (74%), cold-pressed groundnut oil, dried fenugreek leaves (4%), turmeric, red chilli, cumin, rock salt.",
    nutrition: n(132, 3.9, 19.8, 0.5, 4.1, 0.7, 176, 3.2), availableInRetail: true, stock: "healthy", popularity: 8,
  },
  {
    brand: "the-true-store", category: "Healthy Namkeen", sku: "TTS-NMK-005", name: "Nylon Poha Chevdo",
    slug: "nylon-poha-chevdo", type: "PACKAGED_FOOD",
    short: "Thin poha, curry leaves, peanuts and a whisper of sugar. Roasted, the Vadodara way.",
    description:
      "Paper-thin poha roasted in a heavy kadai with curry leaves, peanuts, roasted chana and green chilli, finished with the pinch of sugar that makes it Gujarati. Roasted in groundnut oil, not fried.",
    price: 139, mrp: 149, hsn: "21069099", tax: 5, shelfLifeDays: 120, isVeg: true, allergens: ["Peanuts"],
    netQuantity: "200 g", weightGrams: 220,
    ingredients: "Flattened rice (nylon poha) (60%), peanuts (14%), roasted chana, groundnut oil, curry leaves, green chilli, sugar, turmeric, rock salt, citric acid.",
    nutrition: n(141, 4.1, 18.9, 2.1, 5.6, 0.9, 198, 1.8), stock: "healthy", popularity: 7,
  },
  {
    brand: "the-true-store", category: "Healthy Namkeen", sku: "TTS-NMK-006", name: "Roasted Chana Jor Garam",
    slug: "roasted-chana-jor-garam", type: "PACKAGED_FOOD",
    short: "Flattened, roasted black chana with lemon, chilli and chaat masala.",
    description:
      "The street-cart classic, made at home scale: black chana soaked, flattened, roasted till crisp, then dressed with lemon, red chilli and our own chaat masala. 7 g of protein per serving.",
    price: 119, mrp: 119, hsn: "21069099", tax: 5, shelfLifeDays: 150, isVeg: true, allergens: [],
    netQuantity: "150 g", weightGrams: 165,
    ingredients: "Black chickpeas (86%), rice bran oil, chaat masala (dry mango, cumin, black salt, black pepper), red chilli, lemon powder.",
    nutrition: n(126, 7.1, 16.4, 1.2, 3.3, 0.5, 201, 5.2), stock: "low", popularity: 5,
  },

  /* ------------------------------------------------- The True Store: sweets */
  {
    brand: "the-true-store", category: "Healthy Sweets", sku: "TTS-SWT-001", name: "Date & Almond Laddoo",
    slug: "date-almond-laddoo", type: "PACKAGED_FOOD",
    short: "Soft laddoos sweetened only with dates, rolled with almonds and a touch of cardamom.",
    description:
      "Medjool-style dates slow-cooked with ghee, almonds, cashew and green cardamom, rolled by hand into 12 laddoos. No refined sugar at all: the sweetness is the dates.",
    price: 349, mrp: 349, hsn: "21069099", tax: 5, shelfLifeDays: 90, isVeg: true, allergens: ["Almonds", "Cashew", "Milk (ghee)"],
    netQuantity: "12 pieces (300 g)", weightGrams: 330,
    ingredients: "Dates (58%), almonds (18%), cashew nuts, ghee, desiccated coconut, green cardamom.",
    nutrition: n(126, 2.4, 16.8, 13.9, 5.6, 1.9, 4, 2.1, 25), featured: true, availableInRetail: true, stock: "healthy", popularity: 9,
  },
  {
    brand: "the-true-store", category: "Healthy Sweets", sku: "TTS-SWT-002", name: "Jaggery Sukhdi Bites",
    slug: "jaggery-sukhdi-bites", type: "PACKAGED_FOOD",
    short: "Gujarat's three-ingredient sweet, cut into bites: whole wheat, ghee and jaggery.",
    description:
      "Sukhdi as it's made for Navratri prasad: whole-wheat flour roasted in ghee till nutty, folded into melted kolhapuri jaggery, set and cut into bites. Nothing else.",
    price: 229, mrp: 249, hsn: "17049090", tax: 5, shelfLifeDays: 120, isVeg: true, allergens: ["Wheat (gluten)", "Milk (ghee)"],
    netQuantity: "250 g", weightGrams: 275,
    ingredients: "Whole wheat flour (42%), jaggery (34%), ghee (24%).",
    nutrition: n(141, 1.9, 17.2, 9.8, 7.3, 4.5, 3, 1.1, 25), availableInRetail: true, stock: "healthy", popularity: 7,
  },
  {
    brand: "the-true-store", category: "Healthy Sweets", sku: "TTS-SWT-003", name: "Millet Nankhatai",
    slug: "millet-nankhatai", type: "PACKAGED_FOOD",
    short: "Crumbly, cardamom-scented cookies made with jowar, bajra and ghee.",
    description:
      "The bakery-counter nankhatai, rebuilt on jowar and bajra flour with ghee and a little jaggery powder. Crumbly, fragrant, and best with a cutting chai.",
    price: 179, mrp: 179, hsn: "19053100", tax: 5, shelfLifeDays: 120, isVeg: true, allergens: ["Milk (ghee)"],
    netQuantity: "200 g", weightGrams: 220,
    ingredients: "Sorghum flour (32%), pearl millet flour (18%), ghee, jaggery powder, gram flour, green cardamom, nutmeg, baking soda.",
    nutrition: n(152, 2.6, 17.9, 7.1, 7.9, 4.8, 42, 1.6), stock: "healthy", popularity: 6,
  },
  {
    brand: "the-true-store", category: "Healthy Sweets", sku: "TTS-SWT-004", name: "Til Chikki Squares",
    slug: "til-chikki-squares", type: "PACKAGED_FOOD",
    short: "Thin, snappy sesame chikki set in jaggery. Uttarayan in a box, any month.",
    description:
      "White sesame roasted and set in jaggery syrup, rolled thin and cut into squares that snap cleanly. Made for Uttarayan, eaten all year.",
    price: 99, mrp: 99, hsn: "17049090", tax: 5, shelfLifeDays: 150, isVeg: true, allergens: ["Sesame"],
    netQuantity: "150 g", weightGrams: 165,
    ingredients: "Sesame seeds (55%), jaggery (44%), ghee.",
    nutrition: n(146, 3.9, 13.8, 10.9, 8.6, 1.3, 6, 2.3, 25), stock: "out", popularity: 5,
  },

  /* ----------------------------------------------- The True Store: munchies */
  {
    brand: "the-true-store", category: "Healthy Munchies", sku: "TTS-MUN-001", name: "Beetroot & Sweet Potato Chips",
    slug: "beetroot-sweet-potato-chips", type: "PACKAGED_FOOD",
    short: "Vacuum-fried root vegetable chips with Himalayan pink salt.",
    description:
      "Beetroot and sweet potato sliced thin and vacuum-fried at a lower temperature, which keeps the colour and uses far less oil than regular chips. Finished with pink salt and nothing else.",
    price: 149, mrp: 149, hsn: "20052000", tax: 5, shelfLifeDays: 180, isVeg: true, allergens: [],
    netQuantity: "70 g", weightGrams: 85,
    ingredients: "Sweet potato (48%), beetroot (40%), rice bran oil, Himalayan pink salt.",
    nutrition: n(136, 1.4, 19.3, 5.8, 5.9, 1.1, 142, 3.4), featured: true, stock: "healthy", popularity: 8,
  },
  {
    brand: "the-true-store", category: "Healthy Munchies", sku: "TTS-MUN-002", name: "Trail Mix, Desi Edition",
    slug: "trail-mix-desi-edition", type: "PACKAGED_FOOD",
    short: "Almonds, cashews, roasted chana, pumpkin seeds and black raisins, lightly salted.",
    description:
      "A handful that keeps you going through a long afternoon: almonds, cashews, roasted chana, pumpkin and sunflower seeds, black raisins and a pinch of chaat masala.",
    price: 299, mrp: 299, hsn: "20081990", tax: 5, shelfLifeDays: 180, isVeg: true, allergens: ["Almonds", "Cashew"],
    netQuantity: "200 g", weightGrams: 220,
    ingredients: "Almonds (24%), cashew nuts (18%), roasted chana, pumpkin seeds, sunflower seeds, black raisins (12%), chaat masala, rock salt.",
    nutrition: n(158, 5.6, 11.9, 5.2, 10.2, 1.5, 88, 2.6), availableInRetail: true, stock: "healthy", popularity: 7,
  },
  {
    brand: "the-true-store", category: "Healthy Munchies", sku: "TTS-MUN-003", name: "Quinoa Puffs, Cheese & Herbs",
    slug: "quinoa-puffs-cheese-herbs", type: "PACKAGED_FOOD",
    short: "Crunchy quinoa and rice puffs with real cheddar and Italian herbs.",
    description:
      "Quinoa and rice puffed, then tumbled in real aged cheddar powder, oregano, basil and garlic. For the movie-night bowl.",
    price: 150, mrp: 150, discountPercent: 10, hsn: "19049000", tax: 5, shelfLifeDays: 180, isVeg: true, allergens: ["Milk"],
    netQuantity: "60 g", weightGrams: 72,
    ingredients: "Quinoa (42%), rice, rice bran oil, cheese powder (cheddar cheese, milk solids) (8%), oregano, basil, garlic powder, rock salt.",
    nutrition: n(118, 3.4, 17.1, 1.4, 3.9, 1.2, 214, 1.9, 25), stock: "healthy", popularity: 6,
  },
  {
    brand: "the-true-store", category: "Healthy Munchies", sku: "TTS-MUN-004", name: "Roasted Peanuts, Lemon & Pudina",
    slug: "roasted-peanuts-lemon-pudina", type: "PACKAGED_FOOD",
    short: "Saurashtra groundnuts, dry-roasted in the shell's heat, with lemon and mint.",
    description:
      "Bold Saurashtra groundnuts dry-roasted, then coated in a light besan batter with dried mint, lemon and green chilli, and roasted again. No frying.",
    price: 109, mrp: 109, hsn: "20081100", tax: 5, shelfLifeDays: 150, isVeg: true, allergens: ["Peanuts"],
    netQuantity: "200 g", weightGrams: 220,
    ingredients: "Peanuts (71%), gram flour, rice flour, dried mint (2%), lemon powder, green chilli, rock salt, rice bran oil.",
    nutrition: n(168, 7.2, 8.9, 1.3, 11.4, 1.7, 162, 2.7), availableInRetail: true, stock: "healthy", popularity: 7,
  },
  {
    brand: "the-true-store", category: "Healthy Munchies", sku: "TTS-MUN-005", name: "Dark Chocolate Coated Makhana",
    slug: "dark-chocolate-makhana", type: "PACKAGED_FOOD",
    short: "Roasted makhana in a thin shell of 55% dark chocolate.",
    description:
      "Our roasted makhana, cooled and panned in 55% dark chocolate for a light, crunchy sweet that isn't a mithai. Keep it somewhere cool in summer.",
    price: 249, mrp: 249, hsn: "18069090", tax: 5, shelfLifeDays: 120, isVeg: true, allergens: ["Milk", "Soy"],
    netQuantity: "90 g", weightGrams: 105,
    ingredients: "Dark chocolate (55% cocoa) (62%) (cocoa mass, sugar, cocoa butter, soy lecithin, milk solids), fox nuts (makhana) (38%).",
    nutrition: n(139, 2.6, 15.1, 8.4, 7.6, 4.4, 9, 2.8, 25), stock: "low", popularity: 6,
  },

  /* -------------------------------------------------- The True Store: gifts */
  {
    brand: "the-true-store", category: "Gifting & Hampers", sku: "TTS-GFT-001", name: "Rakhi Snack Hamper",
    slug: "rakhi-snack-hamper", type: "PACKAGED_FOOD",
    short: "Six of our best-sellers in a keepsake kraft box, with a hand-tied rakhi card.",
    description:
      "Roasted Masala Makhana, Date & Almond Laddoo, Methi Khakhra Crisps, Trail Mix, Jaggery Sukhdi Bites and Til Chikki, packed in a reusable kraft box with a card you can write on. Ships in one parcel anywhere in Gujarat.",
    price: 1199, mrp: 1299, hsn: "21069099", tax: 5, shelfLifeDays: 90, isVeg: true,
    allergens: ["Almonds", "Cashew", "Milk (ghee)", "Wheat (gluten)", "Sesame", "May contain traces of peanuts"],
    netQuantity: "6 packs (1.18 kg)", weightGrams: 1450,
    ingredients: "Assorted: see each pack. Box and card: recycled kraft board.",
    nutrition: n(141, 3.4, 17.6, 6.2, 6.3, 1.9, 118, 2.3), featured: true, stock: "healthy", popularity: 5,
  },
  {
    brand: "the-true-store", category: "Gifting & Hampers", sku: "TTS-GFT-002", name: "Festive Mithai Box",
    slug: "festive-mithai-box", type: "PACKAGED_FOOD",
    short: "Laddoo, sukhdi, nankhatai and chikki: four refined-sugar-free sweets in one box.",
    description:
      "Date & Almond Laddoo, Jaggery Sukhdi Bites, Millet Nankhatai and Til Chikki Squares, sweetened with dates and jaggery only. The box you can take to anyone's home.",
    price: 799, mrp: 849, hsn: "21069099", tax: 5, shelfLifeDays: 90, isVeg: true,
    allergens: ["Almonds", "Cashew", "Milk (ghee)", "Wheat (gluten)", "Sesame"],
    netQuantity: "4 packs (900 g)", weightGrams: 1080,
    ingredients: "Assorted: see each pack.",
    nutrition: n(146, 2.7, 16.5, 10.3, 7.4, 3.2, 14, 1.8, 25), availableInRetail: true, stock: "healthy", popularity: 4,
  },
  {
    brand: "the-true-store", category: "Gifting & Hampers", sku: "TTS-GFT-003", name: "Corporate Wellness Crate",
    slug: "corporate-wellness-crate", type: "PACKAGED_FOOD",
    short: "Ten snack packs in a wooden crate, for teams and clients. Custom notes on request.",
    description:
      "Ten of our namkeen, munchies and sweets in a reusable pine crate with a printed menu card. Popular for Diwali client gifting; order by early October for festive dispatch.",
    price: 1999, mrp: 2199, hsn: "21069099", tax: 5, shelfLifeDays: 90, isVeg: true,
    allergens: ["Almonds", "Cashew", "Milk", "Wheat (gluten)", "Sesame", "Peanuts", "Soy"],
    netQuantity: "10 packs (1.9 kg)", weightGrams: 2600,
    ingredients: "Assorted: see each pack. Crate: untreated pine.",
    nutrition: n(138, 3.9, 16.8, 4.1, 6.1, 1.4, 142, 2.5), stock: "healthy", popularity: 2,
  },

  /* ---------------------------------------------------------- Woman Axis */
  {
    brand: "woman-axis", category: "Daily Vitamin", sku: "WAX-DV-001", name: "Everyday Women's Multivitamin Gummies",
    slug: "everyday-womens-multivitamin", type: "HEALTH_SUPPLEMENT",
    short: "Twelve vitamins and minerals in a pomegranate gummy, formulated around women's daily needs.",
    description:
      "One pomegranate-flavoured gummy a day with folate, iron, vitamin B12, vitamin D3 and zinc, among twelve nutrients. Folate contributes to normal blood formation, and iron to the normal transport of oxygen in the body.\n\nPectin-based, so vegetarian. No artificial colours.",
    price: 599, mrp: 649, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "30 gummies (90 g)", weightGrams: 140,
    ingredients: "Sugar, glucose syrup, pectin, vitamin and mineral premix, citric acid, natural pomegranate flavour, fruit and vegetable concentrate (colour), coconut oil (glazing agent).",
    supplement: {
      servings: 30, dosage: "Chew 1 gummy daily, after a meal. " + DAILY, sugarG: 1.8,
      facts: [
        { ingredient: "Folate (as folic acid)", amountPerServing: "200 mcg", percentRDA: 91 },
        { ingredient: "Iron", amountPerServing: "8 mg", percentRDA: 28 },
        { ingredient: "Vitamin B12", amountPerServing: "2 mcg", percentRDA: 91 },
        { ingredient: "Vitamin D3", amountPerServing: "400 IU", percentRDA: 67 },
        { ingredient: "Zinc", amountPerServing: "5 mg", percentRDA: 38 },
        { ingredient: "Vitamin C", amountPerServing: "40 mg", percentRDA: 62 },
      ],
    },
    featured: true, stock: "healthy", popularity: 10,
  },
  {
    brand: "woman-axis", category: "Sleep Support", sku: "WAX-SL-001", name: "Calm Night Sleep Gummies",
    slug: "calm-night-sleep-gummies", type: "HEALTH_SUPPLEMENT",
    short: "Chamomile, L-theanine and magnesium in a berry gummy for your wind-down routine.",
    description:
      "A wind-down gummy for the half hour before bed: chamomile extract, L-theanine and magnesium glycinate. Magnesium contributes to normal functioning of the nervous system.\n\nMelatonin-free, so it fits a routine rather than replacing one.",
    price: 650, mrp: 699, discountPercent: 20, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "30 gummies (90 g)", weightGrams: 140,
    ingredients: "Sugar, glucose syrup, pectin, magnesium glycinate, L-theanine, chamomile flower extract, citric acid, natural mixed berry flavour, black carrot concentrate (colour).",
    supplement: {
      servings: 30, dosage: "Chew 1 gummy 30 minutes before bed. " + DAILY, sugarG: 1.6,
      facts: [
        { ingredient: "Magnesium (as glycinate)", amountPerServing: "50 mg", percentRDA: 14 },
        { ingredient: "L-theanine", amountPerServing: "100 mg", percentRDA: null },
        { ingredient: "Chamomile extract", amountPerServing: "75 mg", percentRDA: null },
      ],
    },
    stock: "healthy", popularity: 8,
  },
  {
    brand: "woman-axis", category: "Stress Relief", sku: "WAX-ST-001", name: "Ashwagandha Balance Gummies",
    slug: "ashwagandha-balance-gummies", type: "HEALTH_SUPPLEMENT",
    short: "KSM-66-style ashwagandha root extract with vitamin B6, in a mango gummy.",
    description:
      "Standardised ashwagandha root extract with vitamin B6, which contributes to normal psychological function and to the reduction of tiredness. Alphonso mango flavour.\n\nNot recommended during pregnancy or breastfeeding.",
    price: 549, mrp: 549, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "30 gummies (90 g)", weightGrams: 140,
    ingredients: "Sugar, glucose syrup, pectin, ashwagandha root extract, pyridoxine hydrochloride, citric acid, natural mango flavour, beta-carotene (colour).",
    supplement: {
      servings: 30, dosage: "Chew 1 gummy daily with a meal. " + DAILY + " Not recommended during pregnancy or breastfeeding.", sugarG: 1.7,
      facts: [
        { ingredient: "Ashwagandha root extract", amountPerServing: "300 mg", percentRDA: null },
        { ingredient: "Vitamin B6", amountPerServing: "1 mg", percentRDA: 53 },
      ],
    },
    stock: "healthy", popularity: 7,
  },
  {
    brand: "woman-axis", category: "Weight Management", sku: "WAX-WM-001", name: "Apple Cider Vinegar Gummies",
    slug: "apple-cider-vinegar-gummies", type: "HEALTH_SUPPLEMENT",
    short: "Raw apple cider vinegar with the mother, minus the sharp taste, in a green apple gummy.",
    description:
      "Unfiltered apple cider vinegar with the mother, plus vitamin B12, in a green-apple gummy that's kinder on your teeth than a shot of vinegar. A companion to regular meals and movement, not a shortcut.",
    price: 499, mrp: 549, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "30 gummies (90 g)", weightGrams: 140,
    ingredients: "Sugar, glucose syrup, apple cider vinegar powder (with mother), pectin, cyanocobalamin, citric acid, natural green apple flavour, spirulina extract (colour).",
    supplement: {
      servings: 30, dosage: "Chew 1 gummy daily before your largest meal. " + DAILY, sugarG: 2.0,
      facts: [
        { ingredient: "Apple cider vinegar powder", amountPerServing: "500 mg", percentRDA: null },
        { ingredient: "Vitamin B12", amountPerServing: "1.2 mcg", percentRDA: 55 },
      ],
    },
    stock: "low", popularity: 7,
  },
  {
    brand: "woman-axis", category: "Skin, Nail & Hair", sku: "WAX-SNH-001", name: "Biotin Glow Gummies",
    slug: "biotin-glow-gummies", type: "HEALTH_SUPPLEMENT",
    short: "Biotin, zinc and vitamin E in a strawberry gummy for your skin, hair and nails.",
    description:
      "Biotin contributes to the maintenance of normal hair and skin, and zinc to the maintenance of normal nails. Add vitamin E and a strawberry flavour you'll look forward to.",
    price: 549, mrp: 599, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "30 gummies (90 g)", weightGrams: 140,
    ingredients: "Sugar, glucose syrup, pectin, zinc citrate, D-biotin, vitamin E acetate, citric acid, natural strawberry flavour, beetroot concentrate (colour).",
    supplement: {
      servings: 30, dosage: "Chew 1 gummy daily. " + DAILY, sugarG: 1.8,
      facts: [
        { ingredient: "Biotin", amountPerServing: "30 mcg", percentRDA: 75 },
        { ingredient: "Zinc", amountPerServing: "5 mg", percentRDA: 38 },
        { ingredient: "Vitamin E", amountPerServing: "5 mg", percentRDA: 67 },
      ],
    },
    featured: true, stock: "healthy", popularity: 9,
  },
  {
    brand: "woman-axis", category: "Energy Gummies", sku: "WAX-EN-001", name: "B-Complex Daily Energy Gummies",
    slug: "b-complex-daily-energy-gummies", type: "HEALTH_SUPPLEMENT",
    short: "Eight B vitamins in an orange gummy, for days that start early and end late.",
    description:
      "All eight B vitamins, which contribute to normal energy-yielding metabolism and the reduction of tiredness and fatigue. Caffeine-free and orange-flavoured.",
    price: 499, mrp: 499, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "30 gummies (90 g)", weightGrams: 140,
    ingredients: "Sugar, glucose syrup, pectin, vitamin B-complex premix, citric acid, natural orange flavour, paprika extract (colour).",
    supplement: {
      servings: 30, dosage: "Chew 1 gummy each morning. " + DAILY, sugarG: 1.7,
      facts: [
        { ingredient: "Vitamin B1 (thiamine)", amountPerServing: "0.7 mg", percentRDA: 50 },
        { ingredient: "Vitamin B2 (riboflavin)", amountPerServing: "0.8 mg", percentRDA: 47 },
        { ingredient: "Niacin", amountPerServing: "8 mg", percentRDA: 57 },
        { ingredient: "Vitamin B6", amountPerServing: "1 mg", percentRDA: 53 },
        { ingredient: "Vitamin B12", amountPerServing: "1.2 mcg", percentRDA: 55 },
      ],
    },
    stock: "healthy", popularity: 6,
  },
  {
    brand: "woman-axis", category: "PMS & Menopause", sku: "WAX-PM-001", name: "Monthly Comfort Gummies",
    slug: "monthly-comfort-gummies", type: "HEALTH_SUPPLEMENT",
    short: "Chasteberry, magnesium and vitamin B6 in a raspberry gummy, for every week of your cycle.",
    description:
      "Chasteberry extract with magnesium and vitamin B6, which contributes to the regulation of hormonal activity. Raspberry flavour, one a day, every day of the month.",
    price: 599, mrp: 599, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "30 gummies (90 g)", weightGrams: 140,
    ingredients: "Sugar, glucose syrup, pectin, magnesium citrate, chasteberry fruit extract, pyridoxine hydrochloride, citric acid, natural raspberry flavour, purple carrot concentrate (colour).",
    supplement: {
      servings: 30, dosage: "Chew 1 gummy daily. " + DAILY + " Not for use during pregnancy.", sugarG: 1.7,
      facts: [
        { ingredient: "Chasteberry extract", amountPerServing: "20 mg", percentRDA: null },
        { ingredient: "Magnesium", amountPerServing: "40 mg", percentRDA: 11 },
        { ingredient: "Vitamin B6", amountPerServing: "1.2 mg", percentRDA: 63 },
      ],
    },
    stock: "healthy", popularity: 5,
  },
  {
    brand: "woman-axis", category: "Digestive Gummies", sku: "WAX-DG-001", name: "Probiotic Gut Balance Gummies",
    slug: "probiotic-gut-balance-gummies", type: "HEALTH_SUPPLEMENT",
    short: "Two billion spore-forming probiotics and prebiotic fibre in a litchi gummy.",
    description:
      "Bacillus coagulans, a spore-forming probiotic that holds up in a gummy, with inulin as a prebiotic fibre. Litchi flavour. Supports your digestive routine alongside a fibre-rich diet.",
    price: 599, mrp: 649, hsn: "21069099", tax: 18, shelfLifeDays: 365, isVeg: true, allergens: [],
    netQuantity: "30 gummies (90 g)", weightGrams: 140,
    ingredients: "Sugar, glucose syrup, pectin, inulin, Bacillus coagulans, citric acid, natural litchi flavour.",
    supplement: {
      servings: 30, dosage: "Chew 1 gummy daily after a meal. " + DAILY, sugarG: 1.5,
      facts: [
        { ingredient: "Bacillus coagulans", amountPerServing: "2 billion CFU", percentRDA: null },
        { ingredient: "Inulin (prebiotic fibre)", amountPerServing: "500 mg", percentRDA: null },
      ],
    },
    stock: "healthy", popularity: 5,
  },

  /* ----------------------------------------------------------- Kids Vault */
  {
    brand: "kids-vault", category: "Multivitamin", sku: "KV-MV-001", name: "Kids Daily Multivitamin Gummies",
    slug: "kids-daily-multivitamin", type: "HEALTH_SUPPLEMENT",
    short: "Ten vitamins and minerals in fun fruit shapes. Mixed-fruit flavour, no artificial colours.",
    description:
      "Two fruit-shaped gummies a day with vitamins A, C, D3, E, B6, B12, folate, zinc and iodine, formulated for children aged 4 to 12. Vitamin D contributes to the normal growth and development of bone in children.",
    price: 499, mrp: 549, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "60 gummies (150 g)", weightGrams: 210,
    ingredients: "Sugar, glucose syrup, pectin, vitamin and mineral premix, citric acid, natural mixed-fruit flavour, fruit and vegetable concentrates (colour), coconut oil.",
    supplement: {
      servings: 30, dosage: "Children 4–12 years: chew 2 gummies daily under adult supervision. " + DAILY + " Keep out of reach of children.", sugarG: 2.4,
      facts: [
        { ingredient: "Vitamin D3", amountPerServing: "400 IU", percentRDA: 67 },
        { ingredient: "Vitamin C", amountPerServing: "30 mg", percentRDA: 67 },
        { ingredient: "Vitamin A", amountPerServing: "200 mcg", percentRDA: 44 },
        { ingredient: "Zinc", amountPerServing: "3 mg", percentRDA: 40 },
        { ingredient: "Iodine", amountPerServing: "45 mcg", percentRDA: 50 },
      ],
    },
    ages: [4, 12], featured: true, stock: "healthy", popularity: 10,
  },
  {
    brand: "kids-vault", category: "Immunity", sku: "KV-IM-001", name: "Vitamin C + Zinc Kids Gummies",
    slug: "vitamin-c-zinc-kids-gummies", type: "HEALTH_SUPPLEMENT",
    short: "Amla-sourced vitamin C with zinc, in an orange gummy kids actually ask for.",
    description:
      "Vitamin C from amla and zinc, both of which contribute to the normal function of the immune system. Orange flavour, star-shaped, for children aged 4 and up.",
    price: 399, mrp: 399, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "30 gummies (75 g)", weightGrams: 120,
    ingredients: "Sugar, glucose syrup, pectin, amla fruit extract (vitamin C), zinc citrate, citric acid, natural orange flavour, paprika extract (colour).",
    supplement: {
      servings: 30, dosage: "Children 4 years and above: chew 1 gummy daily under adult supervision. " + DAILY + " Keep out of reach of children.", sugarG: 1.4,
      facts: [
        { ingredient: "Vitamin C (from amla)", amountPerServing: "40 mg", percentRDA: 89 },
        { ingredient: "Zinc", amountPerServing: "3 mg", percentRDA: 40 },
      ],
    },
    ages: [4, 14], stock: "healthy", popularity: 8,
  },
  {
    brand: "kids-vault", category: "Eye Care", sku: "KV-EC-001", name: "Lutein Bright Eyes Gummies",
    slug: "lutein-bright-eyes-gummies", type: "HEALTH_SUPPLEMENT",
    short: "Lutein, zeaxanthin and vitamin A for screen-heavy school years. Blueberry flavour.",
    description:
      "Lutein and zeaxanthin from marigold, with vitamin A, which contributes to the maintenance of normal vision. Blueberry flavour, for children aged 6 and up.",
    price: 549, mrp: 549, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "30 gummies (75 g)", weightGrams: 120,
    ingredients: "Sugar, glucose syrup, pectin, marigold flower extract (lutein, zeaxanthin), vitamin A acetate, citric acid, natural blueberry flavour, black carrot concentrate (colour).",
    supplement: {
      servings: 30, dosage: "Children 6 years and above: chew 1 gummy daily under adult supervision. " + DAILY + " Keep out of reach of children.", sugarG: 1.4,
      facts: [
        { ingredient: "Lutein", amountPerServing: "5 mg", percentRDA: null },
        { ingredient: "Zeaxanthin", amountPerServing: "1 mg", percentRDA: null },
        { ingredient: "Vitamin A", amountPerServing: "200 mcg", percentRDA: 44 },
      ],
    },
    ages: [6, 14], stock: "healthy", popularity: 5,
  },
  {
    brand: "kids-vault", category: "Memory & Brain Focus", sku: "KV-MB-001", name: "Omega Focus Kids Gummies",
    slug: "omega-focus-kids-gummies", type: "HEALTH_SUPPLEMENT",
    short: "Algal DHA with iodine and iron, in a vegetarian tutti-frutti gummy.",
    description:
      "Plant-based DHA from algae, with iodine, which contributes to normal cognitive function, and iron. Vegetarian, tutti-frutti flavoured, and no fishy aftertaste.",
    price: 649, mrp: 699, hsn: "21069099", tax: 18, shelfLifeDays: 365, isVeg: true, allergens: [],
    netQuantity: "30 gummies (75 g)", weightGrams: 120,
    ingredients: "Sugar, glucose syrup, pectin, algal oil powder (DHA), ferrous fumarate, potassium iodide, citric acid, natural tutti-frutti flavour, fruit and vegetable concentrates (colour).",
    supplement: {
      servings: 30, dosage: "Children 4 years and above: chew 1 gummy daily under adult supervision. " + DAILY + " Keep out of reach of children.", sugarG: 1.5,
      facts: [
        { ingredient: "DHA (from algal oil)", amountPerServing: "50 mg", percentRDA: null },
        { ingredient: "Iodine", amountPerServing: "30 mcg", percentRDA: 33 },
        { ingredient: "Iron", amountPerServing: "3 mg", percentRDA: 18 },
      ],
    },
    ages: [4, 12], stock: "low", popularity: 6,
  },
  {
    brand: "kids-vault", category: "Calcium + D3", sku: "KV-CD-001", name: "Calcium + D3 Strong Bones Gummies",
    slug: "calcium-d3-kids-gummies", type: "HEALTH_SUPPLEMENT",
    short: "Calcium with vitamin D3 and K2, in a creamy strawberry-milk gummy.",
    description:
      "Calcium with vitamins D3 and K2. Calcium and vitamin D are needed for the normal growth and development of bone in children. Strawberry-milk flavour, for ages 4 to 14.",
    price: 449, mrp: 449, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "60 gummies (150 g)", weightGrams: 210,
    ingredients: "Sugar, glucose syrup, calcium citrate, pectin, cholecalciferol, menaquinone-7, citric acid, natural strawberry flavour, beetroot concentrate (colour).",
    supplement: {
      servings: 30, dosage: "Children 4–14 years: chew 2 gummies daily under adult supervision. " + DAILY + " Keep out of reach of children.", sugarG: 2.6,
      facts: [
        { ingredient: "Calcium", amountPerServing: "150 mg", percentRDA: 25 },
        { ingredient: "Vitamin D3", amountPerServing: "400 IU", percentRDA: 67 },
        { ingredient: "Vitamin K2 (MK-7)", amountPerServing: "15 mcg", percentRDA: null },
      ],
    },
    ages: [4, 14], stock: "healthy", popularity: 7,
  },

  /* ---------------------------------------------------------- Man Rituals */
  {
    brand: "man-rituals", category: "Men Vitality", sku: "MR-VT-001", name: "Shilajit Gold Vitality Gummies",
    slug: "shilajit-gold-vitality-gummies", type: "HEALTH_SUPPLEMENT",
    short: "Purified Himalayan shilajit with zinc and ashwagandha, in a dark cherry gummy.",
    description:
      "Purified shilajit resin with ashwagandha and zinc, which contributes to the maintenance of normal testosterone levels in the blood. Dark cherry flavour, one a day.",
    price: 799, mrp: 899, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "30 gummies (90 g)", weightGrams: 140,
    ingredients: "Sugar, glucose syrup, pectin, purified shilajit extract, ashwagandha root extract, zinc citrate, citric acid, natural cherry flavour, caramel (colour).",
    supplement: {
      servings: 30, dosage: "Adults: chew 1 gummy daily after a meal. " + DAILY, sugarG: 1.8,
      facts: [
        { ingredient: "Purified shilajit", amountPerServing: "250 mg", percentRDA: null },
        { ingredient: "Ashwagandha root extract", amountPerServing: "150 mg", percentRDA: null },
        { ingredient: "Zinc", amountPerServing: "8 mg", percentRDA: 47 },
      ],
    },
    featured: true, stock: "healthy", popularity: 9,
  },
  {
    brand: "man-rituals", category: "Multivitamin", sku: "MR-MV-001", name: "Men's Daily Multivitamin Gummies",
    slug: "mens-daily-multivitamin", type: "HEALTH_SUPPLEMENT",
    short: "Fourteen nutrients built around men's daily needs, in a citrus gummy.",
    description:
      "Two citrus gummies a day with vitamins C, D3, E, the B group, zinc, selenium and magnesium. Selenium contributes to normal spermatogenesis and zinc to normal fertility and reproduction.",
    price: 649, mrp: 699, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "60 gummies (180 g)", weightGrams: 240,
    ingredients: "Sugar, glucose syrup, pectin, vitamin and mineral premix, citric acid, natural citrus flavour, paprika extract (colour), coconut oil.",
    supplement: {
      servings: 30, dosage: "Adults: chew 2 gummies daily. " + DAILY, sugarG: 3.2,
      facts: [
        { ingredient: "Vitamin D3", amountPerServing: "600 IU", percentRDA: 100 },
        { ingredient: "Zinc", amountPerServing: "8 mg", percentRDA: 47 },
        { ingredient: "Selenium", amountPerServing: "30 mcg", percentRDA: 75 },
        { ingredient: "Magnesium", amountPerServing: "50 mg", percentRDA: 12 },
        { ingredient: "Vitamin B12", amountPerServing: "2.2 mcg", percentRDA: 100 },
      ],
    },
    stock: "healthy", popularity: 7,
  },
  {
    brand: "man-rituals", category: "Hair Fall", sku: "MR-HF-001", name: "Hair Strength Gummies for Men",
    slug: "hair-strength-gummies-men", type: "HEALTH_SUPPLEMENT",
    short: "Biotin, saw palmetto and zinc in a mint-lime gummy, for your hair routine.",
    description:
      "Biotin contributes to the maintenance of normal hair, joined by zinc, saw palmetto and pumpkin seed extract. Mint-lime flavour. Pairs with, rather than replaces, a good hair-care routine.",
    price: 699, mrp: 749, hsn: "21069099", tax: 18, shelfLifeDays: 540, isVeg: true, allergens: [],
    netQuantity: "30 gummies (90 g)", weightGrams: 140,
    ingredients: "Sugar, glucose syrup, pectin, saw palmetto fruit extract, pumpkin seed extract, zinc citrate, D-biotin, citric acid, natural mint and lime flavours, spirulina extract (colour).",
    supplement: {
      servings: 30, dosage: "Adults: chew 1 gummy daily. " + DAILY, sugarG: 1.7,
      facts: [
        { ingredient: "Biotin", amountPerServing: "40 mcg", percentRDA: 100 },
        { ingredient: "Zinc", amountPerServing: "7 mg", percentRDA: 41 },
        { ingredient: "Saw palmetto extract", amountPerServing: "160 mg", percentRDA: null },
        { ingredient: "Pumpkin seed extract", amountPerServing: "100 mg", percentRDA: null },
      ],
    },
    stock: "healthy", popularity: 8,
  },
];

/** Label declarations shared by every product from the same line. */
export const MAKERS: Record<DemoProduct["brand"], { name: string; address: string }> = {
  "the-true-store": { name: "SooulOne Foods", address: "Plot 14, GIDC Industrial Estate, Sanand, Ahmedabad, Gujarat 382110" },
  "woman-axis": { name: "SooulOne Nutrition", address: "Unit 7, Changodar Industrial Estate, Ahmedabad, Gujarat 382213" },
  "kids-vault": { name: "SooulOne Nutrition", address: "Unit 7, Changodar Industrial Estate, Ahmedabad, Gujarat 382213" },
  "man-rituals": { name: "SooulOne Nutrition", address: "Unit 7, Changodar Industrial Estate, Ahmedabad, Gujarat 382213" },
};
