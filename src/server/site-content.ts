import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { CONTENT_TAG } from "@/lib/cache-tags";
import { withLastGood } from "@/server/last-good";
import { getStoreFacts } from "@/server/store-settings";
import { fillTokens, resolveSiteText, storeFacts, topBarMessages, type FaqItem, type SiteText, type TopBarMessage } from "@/lib/site-content";

/**
 * Reads of the owner's storefront content (src/lib/site-content.ts). Cached
 * and expired when the owner saves (CONTENT_TAG); a database error gives the
 * defaults rather than breaking every page, since the top bar and footer are
 * on all of them.
 */

const CACHE = { revalidate: 600, tags: [CONTENT_TAG] };

/** The default site text with store facts filled in, for when nothing has been read yet. */
function filledDefaults(): SiteText {
  const facts = storeFacts();
  return Object.fromEntries(Object.entries(resolveSiteText([])).map(([k, v]) => [k, fillTokens(v, facts)])) as SiteText;
}

const loadTopBar = unstable_cache(
  async (): Promise<TopBarMessage[]> => {
    const rows = await db.announcement.findMany({ orderBy: { sortOrder: "asc" } });
    return topBarMessages(rows, await getStoreFacts());
  },
  ["top-bar"],
  CACHE,
);

const loadSiteText = unstable_cache(
  async (): Promise<SiteText> => {
    const [rows, facts] = await Promise.all([db.siteText.findMany(), getStoreFacts()]);
    const text = resolveSiteText(rows);
    return Object.fromEntries(Object.entries(text).map(([k, v]) => [k, fillTokens(v, facts)])) as SiteText;
  },
  ["site-text"],
  CACHE,
);

/** Published FAQs, tokens not yet filled (groupFaqs does that). */
const loadFaqs = unstable_cache(
  async (): Promise<FaqItem[]> => {
    const rows = await db.faqEntry.findMany({
      where: { published: true },
      include: { brand: { select: { slug: true } } },
      orderBy: [{ topic: "asc" }, { sortOrder: "asc" }],
    });
    return rows.map((r) => ({ id: r.id, question: r.question, answer: r.answer, topic: r.topic, brandSlug: r.brand?.slug ?? null, sortOrder: r.sortOrder }));
  },
  ["faqs"],
  CACHE,
);

export interface JobListing {
  id: string;
  title: string;
  team: string | null;
  location: string;
  employmentType: string;
  summary: string;
  applyUrl: string | null;
  applyEmail: string | null;
}

const loadOpenRoles = unstable_cache(
  async (): Promise<JobListing[]> => {
    return await db.jobOpening.findMany({
      where: { published: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true, team: true, location: true, employmentType: true, summary: true, applyUrl: true, applyEmail: true },
    });
  },
  ["open-roles"],
  CACHE,
);

export interface ArticleCard {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  pillar: string;
  brandSlug: string | null;
  brandName: string | null;
  coverImageUrl: string | null;
  publishedAt: string | null;
  body: string;
}

/** Published articles, newest first. Dates arrive as ISO strings (cache round trip). */
const loadArticles = unstable_cache(
  async (): Promise<ArticleCard[]> => {
    const rows = await db.article.findMany({
      where: { published: true },
      include: { brand: { select: { slug: true, name: true } } },
      orderBy: { publishedAt: "desc" },
    });
    return rows.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      excerpt: a.excerpt,
      pillar: a.pillar,
      brandSlug: a.brand?.slug ?? null,
      brandName: a.brand?.name ?? null,
      coverImageUrl: a.coverImageUrl,
      publishedAt: a.publishedAt ? new Date(a.publishedAt).toISOString() : null,
      body: a.body,
    }));
  },
  ["articles"],
  CACHE,
);

/** One published article with the products it links to (slugs), or null. */
export const getArticle = unstable_cache(
  async (slug: string) =>
    db.article.findFirst({
      where: { slug, published: true },
      include: { brand: { select: { slug: true, name: true } }, products: { where: { isActive: true }, select: { id: true } } },
    }),
  ["article"],
  CACHE,
);

/*
 * Each loader above throws on a database error, which unstable_cache never
 * stores, and the export answers from the last good read on this server
 * (src/server/last-good.ts). A fallback used to be cached for up to ten
 * minutes: one database blip hid the top bar until the cache expired.
 */
export const getTopBar = withLastGood("site-content/top-bar", loadTopBar, (): TopBarMessage[] => []);

export const getSiteText = withLastGood("site-content/text", loadSiteText, (): SiteText => filledDefaults());

export const getFaqs = withLastGood("site-content/faqs", loadFaqs, (): FaqItem[] => []);

export const getOpenRoles = withLastGood("site-content/careers", loadOpenRoles, (): JobListing[] => []);

export const getArticles = withLastGood("site-content/articles", loadArticles, (): ArticleCard[] => []);
