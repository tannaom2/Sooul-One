import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { headers } from "next/headers";
import { PageHeader, ProductGrid } from "@/components/ui";
import { getSearchCatalog } from "@/server/catalog";
import { getArticles, getFaqs } from "@/server/site-content";
import { brandHost, getBrandFamily } from "@/server/brand-family";
import { overLimit } from "@/server/rate-limit";
import { readSessionId } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { reportError } from "@/lib/observability";
import { clientIp, PUBLIC_LIMITS } from "@/lib/rate-limit-rules";
import { groupByBrand, queryForLog, rank } from "@/lib/search";
import { fillTokens } from "@/lib/site-content";
import { getStoreFacts } from "@/server/store-settings";
import { brandHref } from "@/lib/brand-domains";

export const metadata: Metadata = { title: "Search", robots: { index: false, follow: true } };
export const dynamic = "force-dynamic";

/**
 * Search across every brand at once (src/lib/search.ts). Products come
 * grouped by brand, the brand whose site you're on first; answers and
 * articles that match follow. Each search is counted (the query with digit
 * runs and emails stripped, and how many results) so the console can show
 * what people look for and don't find.
 */
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string; from?: string }> }) {
  const { q = "", from } = await searchParams;
  const query = q.trim().slice(0, 80);
  const host = await brandHost();
  const current = host ?? (from && /^[a-z0-9-]{2,40}$/.test(from) ? from : null);

  let limited = false;
  let products: Awaited<ReturnType<typeof getSearchCatalog>> = [];
  let close = false;
  let faqs: { id: string; name: string; text: string }[] = [];
  let articles: { id: string; slug: string; title: string; excerpt: string }[] = [];
  if (query) {
    try {
      limited = await overLimit(`search:ip:${clientIp(await headers())}`, PUBLIC_LIMITS.search);
    } catch (error) {
      reportError("search/rate-limit", error);
    }
    if (!limited) {
      const [catalog, allFaqs, allArticles, facts] = await Promise.all([getSearchCatalog(), getFaqs(), getArticles(), getStoreFacts()]);
      const hit = rank(
        query,
        catalog.map((c) => ({ ...c, id: c.product.id, name: c.product.name, brand: c.product.brandName, category: c.product.categoryName })),
      );
      products = hit.hits;
      close = hit.close;
      faqs = rank(query, allFaqs.map((f) => ({ ...f, name: fillTokens(f.question, facts), text: fillTokens(f.answer, facts) }))).hits.slice(0, 5);
      articles = rank(query, allArticles.map((a) => ({ ...a, name: a.title, brand: a.brandName ?? undefined, text: a.excerpt }))).hits.slice(0, 4);
      const total = products.length + faqs.length + articles.length;
      const sessionId = (await readSessionId()) ?? "anonymous";
      const logged = queryForLog(query);
      if (logged) after(() => recordEvent(sessionId, "SEARCHED", { metadata: { q: logged, results: total } }));
    }
  }

  const family = await getBrandFamily();
  const groups = groupByBrand(products.map((p) => p.product), current);
  const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

  return (
    <>
      <PageHeader title={query ? `Results for “${query}”` : "Search"} />
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-8">
        <form action="/search" role="search" className="flex max-w-xl gap-3">
          <label htmlFor="q" className="sr-only">
            Search all SooulOne brands
          </label>
          <input id="q" name="q" type="search" defaultValue={query} maxLength={80} placeholder="Search products, ingredients, questions" className="field min-w-0 flex-1" autoFocus={!query} />
          {current && <input type="hidden" name="from" value={current} />}
          <button className="btn btn-solid">Search</button>
        </form>

        <div role="status" aria-live="polite" className="text-small text-ink-soft">
          {limited && <p className="text-alert">That&apos;s a lot of searches in a short time. Wait a few minutes and try again.</p>}
          {query && !limited && (
            <p>
              {products.length} {products.length === 1 ? "product" : "products"}
              {groups.length > 1 ? ` across ${groups.length} brands` : ""}
              {close ? ": no exact match, so here are the closest." : "."}
            </p>
          )}
        </div>

        {groups.map((g) => {
          const href = brandHref(g.brandSlug, family, host, siteUrl);
          return (
            <section key={g.brandSlug} aria-labelledby={`brand-${g.brandSlug}`}>
              <div className="mb-4 flex items-baseline justify-between gap-4">
                <h2 id={`brand-${g.brandSlug}`} className="text-h3 font-bold">
                  {g.brandName}
                  {g.brandSlug === current && <span className="ml-2 text-micro font-medium text-ink-soft">this brand</span>}
                </h2>
                <a href={href} className="text-small underline underline-offset-2">
                  All {g.brandName}
                </a>
              </div>
              <ProductGrid products={g.items} />
            </section>
          );
        })}

        {faqs.length > 0 && (
          <section aria-labelledby="faq-results">
            <h2 id="faq-results" className="mb-3 text-h3 font-bold">
              Answers
            </h2>
            <ul className="panel">
              {faqs.map((f) => (
                <li key={f.id} className="border-b border-rule last:border-b-0">
                  <Link href={`/help#faq-${f.id}`} className="block px-4 py-3 hover:bg-shelf">
                    <span className="font-semibold">{f.name}</span>
                    <span className="mt-1 line-clamp-2 block text-small text-ink-soft">{f.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {articles.length > 0 && (
          <section aria-labelledby="article-results">
            <h2 id="article-results" className="mb-3 text-h3 font-bold">
              From Learn
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {articles.map((a) => (
                <li key={a.id}>
                  <Link href={`/learn/${a.slug}`} className="panel block p-4 hover:bg-shelf">
                    <span className="font-semibold">{a.title}</span>
                    <span className="mt-1 line-clamp-2 block text-small text-ink-soft">{a.excerpt}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {query && !limited && products.length + faqs.length + articles.length === 0 && (
          <div className="border border-dashed border-rule p-8 text-center">
            <p className="font-display text-h3 font-bold">Nothing matched “{query}”</p>
            <p className="mx-auto mt-2 max-w-[48ch] text-small text-ink-soft">
              Try a simpler word, a product type (namkeen, gummies) or an ingredient. Or browse{" "}
              <Link href="/true-store" className="underline">
                The True Store
              </Link>{" "}
              and{" "}
              <Link href="/gummies" className="underline">
                Gummies
              </Link>
              .
            </p>
          </div>
        )}
      </div>
    </>
  );
}
