import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { FAQ_TOPICS, type FaqTopic } from "@/lib/site-content";
import { FaqForm } from "./faq-form";

export const dynamic = "force-dynamic";

/**
 * FAQs for /help. The starting set came with the store: the answers the
 * store's own settings make true are published; the ones that are your
 * policy (returns, refunds, damaged parcels, sourcing) are drafts that say
 * what to write, and can't be published until they're answered.
 */
export default async function Faqs() {
  const session = await requirePermission("content:write");
  if (!session) return <NoAccess />;

  let faqs: Awaited<ReturnType<typeof db.faqEntry.findMany>> = [];
  let brands: { id: string; name: string }[] = [];
  try {
    [faqs, brands] = await Promise.all([
      db.faqEntry.findMany({ orderBy: [{ topic: "asc" }, { sortOrder: "asc" }] }),
      db.brand.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
  } catch (error) {
    reportError("admin/faqs", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }
  const drafts = faqs.filter((f) => !f.published).length;
  const topics = Object.keys(FAQ_TOPICS) as FaqTopic[];

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">FAQs</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          The questions on{" "}
          <Link href="/help" className="underline underline-offset-2" target="_blank">
            the Help page
          </Link>
          . The storefront assistant answers from the published ones too, so one edit updates both.
        </p>
        {drafts > 0 && (
          <p className="mt-3 max-w-[62ch] border-l-4 border-caution bg-shelf p-3 text-small">
            {drafts} {drafts === 1 ? "draft needs" : "drafts need"} your answer. They&apos;re about your own policies, so they stay hidden until you write
            them.
          </p>
        )}
      </div>

      <details className="panel p-4">
        <summary className="cursor-pointer font-semibold">Add a question</summary>
        <div className="mt-4">
          <FaqForm values={{ id: null, question: "", answer: "", topic: "ORDERS", brandId: null, sortOrder: 0, published: false }} brands={brands} />
        </div>
      </details>

      {topics.map((topic) => {
        const items = faqs.filter((f) => f.topic === topic);
        if (items.length === 0) return null;
        return (
          <section key={topic}>
            <h2 className="mb-3 text-h3 font-bold">{FAQ_TOPICS[topic]}</h2>
            <div className="panel">
              {items.map((f) => (
                <details key={f.id} className="border-b border-rule last:border-b-0">
                  <summary className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
                    <span className="font-semibold">{f.question}</span>
                    <span className={`shrink-0 text-micro font-semibold ${f.published ? "text-veg" : "text-caution"}`}>{f.published ? "Published" : "Draft"}</span>
                  </summary>
                  <div className="border-t border-rule p-4">
                    <FaqForm key={f.updatedAt.getTime()} values={f} brands={brands} />
                  </div>
                </details>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
