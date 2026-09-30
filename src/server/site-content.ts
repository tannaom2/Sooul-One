import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { CONTENT_TAG } from "@/lib/cache-tags";
import { reportError } from "@/lib/observability";
import { fillTokens, resolveSiteText, storeFacts, topBarMessages, type FaqItem, type SiteText, type TopBarMessage } from "@/lib/site-content";

/**
 * Reads of the owner's storefront content (src/lib/site-content.ts). Cached
 * and expired when the owner saves (CONTENT_TAG); a database error gives the
 * defaults rather than breaking every page, since the top bar and footer are
 * on all of them.
 */

const CACHE = { revalidate: 600, tags: [CONTENT_TAG] };

export const getTopBar = unstable_cache(
  async (): Promise<TopBarMessage[]> => {
    try {
      const rows = await db.announcement.findMany({ orderBy: { sortOrder: "asc" } });
      return topBarMessages(rows, storeFacts());
    } catch (error) {
      reportError("site-content/top-bar", error);
      return [];
    }
  },
  ["top-bar"],
  CACHE,
);

export const getSiteText = unstable_cache(
  async (): Promise<SiteText> => {
    try {
      const text = resolveSiteText(await db.siteText.findMany());
      const facts = storeFacts();
      return Object.fromEntries(Object.entries(text).map(([k, v]) => [k, fillTokens(v, facts)])) as SiteText;
    } catch (error) {
      reportError("site-content/text", error);
      return resolveSiteText([]);
    }
  },
  ["site-text"],
  CACHE,
);

/** Published FAQs, tokens not yet filled (groupFaqs does that). */
export const getFaqs = unstable_cache(
  async (): Promise<FaqItem[]> => {
    try {
      const rows = await db.faqEntry.findMany({
        where: { published: true },
        include: { brand: { select: { slug: true } } },
        orderBy: [{ topic: "asc" }, { sortOrder: "asc" }],
      });
      return rows.map((r) => ({ id: r.id, question: r.question, answer: r.answer, topic: r.topic, brandSlug: r.brand?.slug ?? null, sortOrder: r.sortOrder }));
    } catch (error) {
      reportError("site-content/faqs", error);
      return [];
    }
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

export const getOpenRoles = unstable_cache(
  async (): Promise<JobListing[]> => {
    try {
      return await db.jobOpening.findMany({
        where: { published: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        select: { id: true, title: true, team: true, location: true, employmentType: true, summary: true, applyUrl: true, applyEmail: true },
      });
    } catch (error) {
      reportError("site-content/careers", error);
      return [];
    }
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
export const getArticles = unstable_cache(
  async (): Promise<ArticleCard[]> => {
    try {
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
    } catch (error) {
      reportError("site-content/articles", error);
      return [];
    }
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
