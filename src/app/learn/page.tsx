import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { getArticles } from "@/server/site-content";
import { getBrandFamily } from "@/server/brand-family";
import { ARTICLE_PILLARS, readingMinutes, type ArticlePillar } from "@/lib/site-content";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Learn",
  description: "Reading labels, ingredients explained, and everyday nutrition for women, men, kids and snack lovers.",
  alternates: { canonical: "/learn" },
};

/**
 * One editorial hub for the whole family (Settings → Articles), with a
 * section per brand. One hub rather than four: every article builds the same
 * domain's search standing, and the family's content is still thin enough
 * that four hubs would each look empty. ?brand= filters to one brand.
 */
export default async function Learn({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { brand } = await searchParams;
  const [articles, family] = await Promise.all([getArticles(), getBrandFamily()]);
  const shown = brand ? articles.filter((a) => a.brandSlug === brand) : articles;
  const brandsWithArticles = family.filter((b) => articles.some((a) => a.brandSlug === b.slug));
  const pill = (active: boolean) => `inline-flex min-h-10 items-center border px-3 text-small ${active ? "border-ink font-semibold" : "border-rule text-ink-soft hover:text-ink"}`;

  return (
    <>
      <PageHeader title="Learn" intro="What's on the label, and why it matters. Straight answers from the SooulOne family." />
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10">
        {brandsWithArticles.length > 0 && (
          <nav aria-label="Filter by brand" className="flex flex-wrap gap-2">
            <Link href="/learn" replace className={pill(!brand)} aria-current={!brand ? "page" : undefined}>
              Everything
            </Link>
            {brandsWithArticles.map((b) => (
              <Link key={b.slug} href={`/learn?brand=${b.slug}`} replace className={pill(brand === b.slug)} aria-current={brand === b.slug ? "page" : undefined}>
                {b.name}
              </Link>
            ))}
          </nav>
        )}

        {shown.length === 0 ? (
          <p className="text-ink-soft">The first articles are being written. Meanwhile, every product page carries its full label.</p>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((a) => (
              <li key={a.id}>
                <Link href={`/learn/${a.slug}`} className="group block h-full border border-rule bg-elevated hover:border-ink">
                  {a.coverImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- owner-supplied URL; next/image needs known hosts
                    <img src={a.coverImageUrl} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" />
                  )}
                  <div className="p-4">
                    <p className="text-micro font-semibold text-ink-soft">
                      {[a.brandName ?? "SooulOne", ARTICLE_PILLARS[a.pillar as ArticlePillar]?.label].filter(Boolean).join(" · ")}
                    </p>
                    <h2 className="mt-1 text-lead font-bold group-hover:underline">{a.title}</h2>
                    <p className="mt-2 line-clamp-3 text-small text-ink-soft">{a.excerpt}</p>
                    <p className="mt-3 text-micro text-ink-faint">
                      {a.publishedAt ? `${formatDate(a.publishedAt)} · ` : ""}
                      {readingMinutes(a.body)} min read
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
