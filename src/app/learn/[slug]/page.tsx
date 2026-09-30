import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ui";
import { RichText } from "@/components/rich-text";
import { getArticle } from "@/server/site-content";
import { getProductSummaries } from "@/server/catalog";
import { ARTICLE_PILLARS, readingMinutes, type ArticlePillar } from "@/lib/site-content";
import { SUPPLEMENT_DISCLAIMER } from "@/lib/compliance/claims";
import { formatDate } from "@/lib/format";

const SUPPLEMENT_BRANDS = new Set(["woman-axis", "kids-vault", "man-rituals"]);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticle(slug).catch(() => null);
  if (!article) return {};
  return {
    title: `${article.title} — SooulOne Learn`,
    description: article.excerpt,
    alternates: { canonical: `/learn/${article.slug}` },
    openGraph: { type: "article", title: article.title, description: article.excerpt, ...(article.coverImageUrl ? { images: [article.coverImageUrl] } : {}) },
  };
}

/** One /learn article, with the products it's about. Supplement-brand articles carry the supplement statement. */
export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) notFound();
  const products = await getProductSummaries(article.products.map((p) => p.id));
  const supplement = article.brand ? SUPPLEMENT_BRANDS.has(article.brand.slug) : false;

  return (
    <article className="mx-auto max-w-3xl px-5 py-10">
      <nav aria-label="Breadcrumb" className="text-small text-ink-soft">
        <Link href="/learn" className="underline underline-offset-2">
          Learn
        </Link>
        {article.brand && (
          <>
            {" / "}
            <Link href={`/learn?brand=${article.brand.slug}`} className="underline underline-offset-2">
              {article.brand.name}
            </Link>
          </>
        )}
      </nav>
      <p className="mt-6 text-micro font-semibold text-ink-soft">{ARTICLE_PILLARS[article.pillar as ArticlePillar]?.label}</p>
      <h1 className="mt-1 text-h1 font-extrabold">{article.title}</h1>
      <p className="mt-3 text-lead text-ink-soft">{article.excerpt}</p>
      <p className="mt-3 text-micro text-ink-faint">
        {article.publishedAt ? `${formatDate(article.publishedAt)} · ` : ""}
        {readingMinutes(article.body)} min read
      </p>
      {article.coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- owner-supplied URL; next/image needs known hosts
        <img src={article.coverImageUrl} alt="" className="mt-6 aspect-[16/9] w-full object-cover" />
      )}
      <div className="mt-8">
        <RichText source={article.body} />
      </div>
      {supplement && <p className="mt-8 border-t border-rule pt-4 text-micro text-ink-soft">{SUPPLEMENT_DISCLAIMER}</p>}
      {products.length > 0 && (
        <section aria-labelledby="in-this-article" className="mt-12">
          <h2 id="in-this-article" className="mb-4 text-h3 font-bold">
            In this article
          </h2>
          <ProductGrid products={products} />
        </section>
      )}
    </article>
  );
}
