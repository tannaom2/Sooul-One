import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { ARTICLE_PILLARS, type ArticlePillar } from "@/lib/site-content";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** /learn articles: drafts and published, newest first. */
export default async function Articles() {
  const session = await requirePermission("content:write");
  if (!session) return <NoAccess />;

  let rows: { id: string; title: string; slug: string; pillar: string; published: boolean; updatedAt: Date; brand: { name: string } | null }[] = [];
  try {
    rows = await db.article.findMany({
      select: { id: true, title: true, slug: true, pillar: true, published: true, updatedAt: true, brand: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    });
  } catch (error) {
    reportError("admin/articles", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h2 font-extrabold">Articles</h1>
          <p className="mt-2 max-w-[62ch] text-ink-soft">
            The{" "}
            <Link href="/learn" target="_blank" className="underline underline-offset-2">
              Learn
            </Link>{" "}
            hub: one place for the whole family, each article tagged with its brand and pillar. Articles about the gummies
            brands pass the same claims check as their product pages.
          </p>
        </div>
        <Link href="/admin/articles/new" className="btn btn-solid">
          New article
        </Link>
      </div>
      {rows.length === 0 ? (
        <Empty title="No articles yet" detail="Start with the questions shoppers already ask: how to read a label, what an ingredient does, how much sugar is in a serving." />
      ) : (
        <div className="panel">
          {rows.map((a) => (
            <Link key={a.id} href={`/admin/articles/${a.id}`} className="grid gap-1 border-b border-rule px-4 py-3 last:border-b-0 hover:bg-shelf sm:grid-cols-[1fr_auto]">
              <span>
                <span className="font-semibold">{a.title}</span>
                <span className="block text-small text-ink-soft">
                  {[a.brand?.name ?? "SooulOne", ARTICLE_PILLARS[a.pillar as ArticlePillar]?.label].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="text-micro text-ink-soft">
                <span className={`font-semibold ${a.published ? "text-veg" : "text-caution"}`}>{a.published ? "Published" : "Draft"}</span> · edited {formatDate(a.updatedAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
