import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { SocialLinks } from "@/components/brand-family";
import { getBusinessProfile } from "@/server/business";
import { getOpenRoles, getSiteText } from "@/server/site-content";
import { turnstileSiteKey } from "@/lib/turnstile";
import { EnquiryForm } from "./enquiry-form";

export const metadata: Metadata = {
  title: "Contact us — SooulOne",
  description: "Customer care, collaborations, deliveries outside India and careers at SooulOne.",
  alternates: { canonical: "/contact" },
};

export const dynamic = "force-dynamic";

const TOPICS = { collaboration: "COLLABORATION", international: "INTERNATIONAL" } as const;

/**
 * Everything about reaching SooulOne on one page: customer care with the
 * hours and response time, the grievance officer, company details, and the
 * collaboration / international / careers blocks. All words are the owner's
 * (Settings → Site text); details come from Business details; each block is
 * left out while its details are missing.
 */
export default async function Contact({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic } = await searchParams;
  const [business, text, roles] = await Promise.all([getBusinessProfile(), getSiteText(), getOpenRoles()]);
  const officer = [business.grievanceOfficerName, business.grievanceOfficerDesignation].filter(Boolean).join(", ");
  const company = [
    business.legalName && ["Company", business.legalName],
    business.cin && ["CIN", business.cin],
    business.gstin && ["GSTIN", business.gstin],
    business.registeredAddress && ["Registered office", business.registeredAddress],
    business.mailingAddress && ["Mailing address", business.mailingAddress],
  ].filter(Boolean) as [string, string][];

  return (
    <>
      <PageHeader title="Contact us" intro={text["contact.intro"] || undefined} />
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-10">
        {/* The promise first: when people hear back is what they want to know. */}
        {text["contact.responseTime"] && <p className="border-l-4 border-veg bg-shelf p-4 font-semibold">{text["contact.responseTime"]}</p>}

        <section aria-labelledby="care" className="grid gap-4 md:grid-cols-3">
          <div className="panel p-5">
            <h2 id="care" className="text-lead font-bold">
              Customer care
            </h2>
            <ul className="mt-2 grid gap-1 text-small text-ink-soft">
              {business.customerCareEmail && (
                <li className="break-all">
                  <a href={`mailto:${business.customerCareEmail}`} className="font-semibold text-ink underline underline-offset-2">
                    {business.customerCareEmail}
                  </a>
                </li>
              )}
              {business.customerCarePhone && <li className="tabular">{business.customerCarePhone}</li>}
              {text["contact.hours"] && <li>{text["contact.hours"]}</li>}
              <li>
                Order questions are quickest through Help (bottom right) or the{" "}
                <Link href="/help" className="underline underline-offset-2">
                  answers page
                </Link>
                .
              </li>
            </ul>
          </div>
          {officer && (
            <div className="panel p-5">
              <h2 className="text-lead font-bold">Grievance officer</h2>
              <ul className="mt-2 grid gap-1 text-small text-ink-soft">
                <li className="text-ink">{officer}</li>
                {business.grievanceOfficerEmail && <li className="break-all">{business.grievanceOfficerEmail}</li>}
                {business.grievanceOfficerPhone && <li className="tabular">{business.grievanceOfficerPhone}</li>}
              </ul>
            </div>
          )}
          {company.length > 0 && (
            <div className="panel p-5">
              <h2 className="text-lead font-bold">Company details</h2>
              <dl className="mt-2 grid gap-1.5 text-small">
                {company.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-micro text-ink-soft">{k}</dt>
                    <dd className="whitespace-pre-line">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {(text["contact.collabTitle"] || text["contact.collabBody"]) && (
            <div className="border border-rule p-5">
              <h2 className="text-lead font-bold">{text["contact.collabTitle"]}</h2>
              <p className="mt-1 text-small text-ink-soft">{text["contact.collabBody"]}</p>
              <Link href="/contact?topic=collaboration#enquiry" className="mt-3 inline-block text-small font-semibold underline underline-offset-2">
                Tell us about it
              </Link>
            </div>
          )}
          {(text["contact.internationalTitle"] || text["contact.internationalBody"]) && (
            <div className="border border-rule p-5">
              <h2 className="text-lead font-bold">{text["contact.internationalTitle"]}</h2>
              <p className="mt-1 text-small text-ink-soft">{text["contact.internationalBody"]}</p>
              <Link href="/contact?topic=international#enquiry" className="mt-3 inline-block text-small font-semibold underline underline-offset-2">
                Fill this in
              </Link>
            </div>
          )}
          {roles.length > 0 && (
            <div className="border border-rule p-5">
              <h2 className="text-lead font-bold">{text["contact.careersTitle"]}</h2>
              <p className="mt-1 text-small text-ink-soft">
                {roles.length} open {roles.length === 1 ? "role" : "roles"}.
              </p>
              <Link href="/careers" className="mt-3 inline-block text-small font-semibold underline underline-offset-2">
                {text["contact.careersBody"] || "See open roles"}
              </Link>
            </div>
          )}
        </section>

        <section id="enquiry" aria-labelledby="enquiry-title" className="scroll-mt-28 grid gap-4 lg:grid-cols-[1fr_2fr]">
          <div>
            <h2 id="enquiry-title" className="text-h3 font-bold">
              Write to us
            </h2>
            <p className="mt-2 text-small text-ink-soft">
              For collaborations, deliveries outside India or anything else. For an existing order, Help (bottom right) is faster.
            </p>
            <div className="mt-4 -ml-2">
              <SocialLinks owner="SooulOne" links={business} />
            </div>
          </div>
          <EnquiryForm
            key={topic ?? "general"}
            initialKind={TOPICS[topic as keyof typeof TOPICS] ?? "GENERAL"}
            turnstileSiteKey={turnstileSiteKey()}
          />
        </section>
      </div>
    </>
  );
}
