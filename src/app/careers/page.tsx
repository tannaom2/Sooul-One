import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { getOpenRoles, getSiteText } from "@/server/site-content";

export const metadata: Metadata = {
  title: "Careers",
  description: "Open roles at SooulOne.",
  alternates: { canonical: "/careers" },
};

/** Open roles (Settings → Careers). With none published, says so and points to the contact form. */
export default async function Careers() {
  const [roles, text] = await Promise.all([getOpenRoles(), getSiteText()]);
  return (
    <>
      <PageHeader title={text["contact.careersTitle"] || "Careers"} intro={roles.length ? `${roles.length} open ${roles.length === 1 ? "role" : "roles"}.` : undefined} />
      <div className="mx-auto grid max-w-3xl gap-4 px-5 py-10">
        {roles.length === 0 && (
          <p className="text-ink-soft">
            No open roles right now. If you&apos;d like us to keep you in mind,{" "}
            <Link href="/contact#enquiry" className="underline underline-offset-2">
              write to us
            </Link>
            .
          </p>
        )}
        {roles.map((r) => {
          const apply = r.applyUrl ?? (r.applyEmail ? `mailto:${r.applyEmail}?subject=${encodeURIComponent(`Application: ${r.title}`)}` : null);
          return (
            <article key={r.id} className="panel p-5">
              <h2 className="text-lead font-bold">{r.title}</h2>
              <p className="mt-1 text-small text-ink-soft">{[r.team, r.location, r.employmentType].filter(Boolean).join(" · ")}</p>
              <p className="mt-3 whitespace-pre-line text-small">{r.summary}</p>
              {apply && (
                <a href={apply} className="btn btn-solid mt-4 inline-flex" {...(r.applyUrl ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  Apply
                </a>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
