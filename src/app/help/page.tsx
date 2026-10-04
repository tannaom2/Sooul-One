import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { JumpLink } from "@/components/jump-link";
import { getFaqs } from "@/server/site-content";
import { getBrandFamily } from "@/server/brand-family";
import { groupFaqs } from "@/lib/site-content";
import { getStoreFacts } from "@/server/store-settings";

export const metadata: Metadata = {
  title: "Questions and answers",
  description: "Orders, delivery, payments, returns and genuine products: answers to what shoppers ask most.",
  alternates: { canonical: "/help" },
};

/**
 * The FAQ page (Settings → FAQs). Answers are the owner's words, with store
 * facts ({freeDelivery}, {area}) filled from the live settings; the Help
 * assistant answers from the same entries. Plain <details>, so it works
 * without JavaScript and each answer has its own link (#faq-id).
 */
export default async function Help() {
  const [faqs, family, facts] = await Promise.all([getFaqs(), getBrandFamily(), getStoreFacts()]);
  const groups = groupFaqs(faqs, facts);
  const brandName = (slug: string | null) => family.find((b) => b.slug === slug)?.name ?? null;

  return (
    <>
      <PageHeader title="Questions and answers" intro="The things people ask us most. Can't find yours? Ask Help (bottom right) or get in touch." />
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-10 lg:grid-cols-[14rem_1fr]">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <nav aria-label="Topics" className="grid gap-1 text-small">
            {groups.map((g) => (
              <JumpLink key={g.topic} href={`#${g.topic.toLowerCase()}`} className="py-1 text-ink-soft hover:text-ink hover:underline">
                {g.label}
              </JumpLink>
            ))}
          </nav>
          <div className="mt-6 grid gap-2 border-t border-rule pt-4 text-small">
            <Link href="/verify" className="underline underline-offset-2">
              Check your batch
            </Link>
            <Link href="/contact" className="underline underline-offset-2">
              Contact us
            </Link>
          </div>
        </aside>

        <div className="grid gap-10">
          {groups.length === 0 && <p className="text-ink-soft">Answers are on their way. Meanwhile, ask Help (bottom right) or get in touch.</p>}
          {groups.map((g) => (
            <section key={g.topic} id={g.topic.toLowerCase()} className="scroll-mt-28">
              <h2 className="mb-3 text-h3 font-bold">{g.label}</h2>
              <div className="panel">
                {g.items.map((f) => (
                  <details key={f.id} id={`faq-${f.id}`} className="group scroll-mt-28 border-b border-rule last:border-b-0">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 font-semibold">
                      <span>
                        {f.question}
                        {brandName(f.brandSlug) && <span className="ml-2 text-micro font-medium text-ink-soft">{brandName(f.brandSlug)}</span>}
                      </span>
                      <span aria-hidden="true" className="text-ink-soft transition-transform group-open:rotate-45">
                        +
                      </span>
                    </summary>
                    <p className="max-w-[68ch] whitespace-pre-line px-4 pb-4 text-ink-soft">{f.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
