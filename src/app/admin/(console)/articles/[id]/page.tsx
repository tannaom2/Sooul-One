import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { ArticleForm, type ArticleValues } from "../article-form";

export const dynamic = "force-dynamic";

/** Write or edit one article (/admin/articles/new for a new one). */
export default async function EditArticle({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const session = await requirePermission("content:write");
  if (!session) return <NoAccess />;
  const { id } = await params;
  const { saved } = await searchParams;

  let brands: { id: string; slug: string; name: string }[] = [];
  let products: { id: string; name: string; brandId: string }[] = [];
  let missing = false;
  let values: ArticleValues = { id: null, title: "", slug: "", excerpt: "", body: "", pillar: "label-literacy", brandId: null, coverImageUrl: null, productIds: [], published: false, reviewedBy: null };
  try {
    const [b, p, article] = await Promise.all([
      db.brand.findMany({ where: { isActive: true }, select: { id: true, slug: true, name: true }, orderBy: { name: "asc" } }),
      db.product.findMany({ where: { isActive: true }, select: { id: true, name: true, brandId: true }, orderBy: { name: "asc" } }),
      id === "new" ? null : db.article.findUnique({ where: { id }, include: { products: { select: { id: true } } } }),
    ]);
    brands = b;
    products = p;
    if (id !== "new" && !article) missing = true;
    else if (article) {
      values = {
        id: article.id,
        title: article.title,
        slug: article.slug,
        excerpt: article.excerpt,
        body: article.body,
        pillar: article.pillar,
        brandId: article.brandId,
        coverImageUrl: article.coverImageUrl,
        productIds: article.products.map((x) => x.id),
        published: article.published,
        reviewedBy: article.complianceReviewedBy,
      };
    }
  } catch (error) {
    reportError("admin/articles/edit", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }
  if (missing) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/articles" className="text-small underline underline-offset-2">
          All articles
        </Link>
        <h1 className="mt-2 text-h2 font-extrabold">{values.id ? "Edit article" : "New article"}</h1>
        {saved && <p className="mt-2 text-small text-veg">Saved.</p>}
        {values.id && values.published && (
          <Link href={`/learn/${values.slug}`} target="_blank" className="mt-2 inline-block text-small underline underline-offset-2">
            View on the site
          </Link>
        )}
      </div>
      <ArticleForm key={values.id ?? "new"} values={values} brands={brands} products={products} />
    </div>
  );
}
