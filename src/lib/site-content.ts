/**
 * Storefront words the owner controls: the top bar, the site text on the
 * contact and verify pages, FAQ topics and article pillars. Pure, so the
 * rules are tested (tests/site-content.test.ts); the reads are in
 * src/server/site-content.ts.
 *
 * One rule keeps the storefront and the owner console in step: a fact the
 * store already holds (the free-delivery amount, the delivery fee, the area)
 * is never typed into copy. Copy names it with a {token}, and the token is
 * filled from the same settings checkout uses (Store controls), so the top bar, the FAQs and
 * checkout can't disagree.
 */

import { DEFAULT_SHIPPING_POLICY, type ShippingPolicy } from "@/lib/checkout/quote";
import { SERVICE_AREA } from "@/lib/checkout/service-area";
import { formatPriceTag } from "@/lib/money";

/* ---------------------------------------------------------------- tokens */

export const TOKENS = {
  freeDelivery: "Free-delivery amount, e.g. ₹799/-",
  deliveryFee: "Delivery fee below that, e.g. ₹59/-",
  area: "Where we deliver, e.g. Gujarat",
} as const;

export type TokenName = keyof typeof TOKENS;
export type StoreFacts = Record<TokenName, string>;

/** The values behind each token, from the owner's fees (getStoreFacts in src/server/store-settings.ts). */
export function storeFacts(shipping: ShippingPolicy = DEFAULT_SHIPPING_POLICY): StoreFacts {
  return {
    freeDelivery: formatPriceTag(shipping.freeAbovePaise),
    deliveryFee: formatPriceTag(shipping.flatRatePaise),
    area: SERVICE_AREA.label,
  };
}

const TOKEN = /\{([a-zA-Z]+)\}/g;

/** Copy with its {tokens} filled in. An unknown token is left as typed (the editor refuses to save one). */
export function fillTokens(text: string, facts: StoreFacts): string {
  return text.replace(TOKEN, (whole, name: string) => (name in facts ? facts[name as TokenName] : whole));
}

/** Tokens in the text that don't exist, for the editor's error message. */
export function unknownTokens(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((m) => m[1]).filter((name) => !(name in TOKENS));
}

/* ------------------------------------------------------------- site text */

export interface SiteTextField {
  readonly label: string;
  readonly group: string;
  readonly default: string;
  readonly max: number;
  readonly multiline?: boolean;
  readonly hint?: string;
}

/**
 * Every editable line, with its default. A default is what shows until the
 * owner changes it; saving a line empty hides it on the site.
 */
export const SITE_TEXT = {
  "contact.intro": {
    label: "Contact page introduction",
    group: "Contact page",
    default: "Questions about an order, a product or working with us: this is where to find us.",
    max: 240,
    multiline: true,
  },
  "contact.responseTime": {
    label: "Response-time promise",
    group: "Contact page",
    default: "Psst! We typically respond within one hour because your time matters.",
    max: 160,
    hint: "Only promise what the team can keep. Leave empty to hide.",
  },
  "contact.hours": {
    label: "Working hours",
    group: "Contact page",
    default: "9 AM – 6 PM IST, Monday to Saturday",
    max: 120,
  },
  "contact.collabTitle": { label: "Collaboration heading", group: "Collaborate", default: "Want to collaborate with us?", max: 80 },
  "contact.collabBody": {
    label: "Collaboration text",
    group: "Collaborate",
    default: "We are all ears! Creators, retailers, distributors and brands: tell us what you have in mind.",
    max: 240,
    multiline: true,
  },
  "contact.internationalTitle": { label: "International heading", group: "International", default: "Want delivery outside of India?", max: 80 },
  "contact.internationalBody": {
    label: "International text",
    group: "International",
    default: "We don't ship abroad yet. Fill this in and we'll let you know how we can help.",
    max: 240,
    multiline: true,
  },
  "contact.careersTitle": { label: "Careers heading", group: "Careers", default: "Think you belong here?", max: 80 },
  "contact.careersBody": {
    label: "Careers text",
    group: "Careers",
    default: "See open roles.",
    max: 200,
    hint: "The careers block shows only while at least one role is published.",
  },
  "verify.intro": {
    label: "Batch check introduction",
    group: "Verify page",
    default:
      "We continuously innovate throughout our value chain, with packaging being a vital cog in the wheel. We make fine changes in design, copy and text to adhere to packaging guidelines and for functional reasons. You can rest assured that the product is genuine and authentic. To check, enter the batch number printed on your pack.",
    max: 600,
    multiline: true,
  },
  "verify.where": {
    label: "Where to find the batch number",
    group: "Verify page",
    default: "The batch number is printed on the pack, usually next to the best-before date. It may be labelled \"Batch\", \"B. No.\" or \"Lot\".",
    max: 240,
    multiline: true,
  },
  "footer.tagline": {
    label: "Footer line under the name",
    group: "Footer",
    default: "Snacks and supplements with the whole label on the page, not just on the pack.",
    max: 160,
  },
} as const satisfies Record<string, SiteTextField>;

export type SiteTextKey = keyof typeof SITE_TEXT;
export type SiteText = Record<SiteTextKey, string>;

export const SITE_TEXT_KEYS = Object.keys(SITE_TEXT) as SiteTextKey[];

/** Defaults overlaid with the owner's saved lines. Unknown keys in the table are ignored. */
export function resolveSiteText(rows: readonly { key: string; value: string }[]): SiteText {
  const out = Object.fromEntries(SITE_TEXT_KEYS.map((k) => [k, SITE_TEXT[k].default])) as SiteText;
  for (const row of rows) if (row.key in SITE_TEXT) out[row.key as SiteTextKey] = row.value;
  return out;
}

/* ------------------------------------------------------------ top bar */

export interface AnnouncementRow {
  readonly id: string;
  readonly text: string;
  readonly href: string | null;
  readonly enabled: boolean;
  readonly sortOrder: number;
}

export interface TopBarMessage {
  readonly id: string;
  readonly text: string;
  readonly href: string | null;
}

/** What the top bar shows: enabled messages in order, tokens filled, empties dropped. */
export function topBarMessages(rows: readonly AnnouncementRow[], facts: StoreFacts): TopBarMessage[] {
  return [...rows]
    .filter((r) => r.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({ id: r.id, text: fillTokens(r.text, facts).trim(), href: safeInternalHref(r.href) }))
    .filter((m) => m.text.length > 0);
}

/**
 * A link the owner typed, kept only when it's a path on this site: "/help",
 * "/policies/shipping#fees". Anything else (other sites, "//evil", "javascript:") is dropped.
 */
export function safeInternalHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const h = href.trim();
  return /^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(h) && h.length <= 200 ? h : null;
}

/* ------------------------------------------------------------ FAQ topics */

export const FAQ_TOPICS = {
  ORDERS: "Orders",
  DELIVERY: "Delivery",
  PAYMENTS: "Payments and offers",
  RETURNS: "Returns and damaged items",
  AUTHENTICITY: "Genuine products",
  PRODUCTS: "Products and ingredients",
} as const;

export type FaqTopic = keyof typeof FAQ_TOPICS;

export interface FaqItem {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly topic: string;
  readonly brandSlug: string | null;
  readonly sortOrder: number;
}

/** Published FAQs grouped by topic, in the topics' order, with tokens filled. Unknown topics go last. */
export function groupFaqs(items: readonly FaqItem[], facts: StoreFacts): { topic: string; label: string; items: FaqItem[] }[] {
  const order = Object.keys(FAQ_TOPICS);
  const topics = [...new Set(items.map((i) => i.topic))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  return topics.map((topic) => ({
    topic,
    label: FAQ_TOPICS[topic as FaqTopic] ?? topic,
    items: items
      .filter((i) => i.topic === topic)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({ ...i, question: fillTokens(i.question, facts), answer: fillTokens(i.answer, facts) })),
  }));
}

/* -------------------------------------------------------- article pillars */

/**
 * The content pillars /learn is organised by. Each brand's pillars are the
 * questions its shoppers already ask; "general" ones belong to SooulOne.
 */
export const ARTICLE_PILLARS = {
  "label-literacy": { label: "Reading labels", brand: null },
  "ingredients": { label: "Ingredients, explained", brand: null },
  "healthy-snacking": { label: "Smarter snacking", brand: "the-true-store" },
  "regional-foods": { label: "Gujarat's snack traditions", brand: "the-true-store" },
  "women-nutrition": { label: "Nutrition through life stages", brand: "woman-axis" },
  "women-routines": { label: "Daily routines", brand: "woman-axis" },
  "kids-nutrition": { label: "Growing-up nutrition", brand: "kids-vault" },
  "parenting-food": { label: "Picky eaters and school days", brand: "kids-vault" },
  "men-routines": { label: "Everyday routines", brand: "man-rituals" },
  "men-fitness": { label: "Energy and fitness", brand: "man-rituals" },
} as const satisfies Record<string, { label: string; brand: string | null }>;

export type ArticlePillar = keyof typeof ARTICLE_PILLARS;

/** Roughly how long an article takes to read, at 200 words a minute; at least one minute. */
export function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** A URL-safe slug from a title: "Why sugar per serving matters!" → "why-sugar-per-serving-matters". */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/-$/, "");
}
