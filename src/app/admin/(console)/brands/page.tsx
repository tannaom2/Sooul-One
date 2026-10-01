import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { brandPath } from "@/lib/brand-domains";
import { BrandForm, type BrandValues } from "./brand-form";

export const dynamic = "force-dynamic";

const ORDER = ["the-true-store", "woman-axis", "kids-vault", "man-rituals"];
const MODE_LABEL = { OFF: "Main site only", REDIRECT: "Domain sends visitors to the main site", STANDALONE: "Own site on its domain" } as const;

/**
 * The brand family: each brand's words, social links and own domain
 * (src/lib/brand-domains.ts). The footer, search and canonical
 * links all follow what's set here.
 */
export default async function Brands() {
  const session = await requirePermission("settings:manage");
  if (!session) return <NoAccess />;

  let brands: BrandValues[] = [];
  try {
    const rows = await db.brand.findMany({
      select: { id: true, slug: true, name: true, tagline: true, description: true, domain: true, domainMode: true, instagramUrl: true, facebookUrl: true, xUrl: true, youtubeUrl: true },
    });
    brands = rows.sort((a, b) => (ORDER.indexOf(a.slug) + 1 || 99) - (ORDER.indexOf(b.slug) + 1 || 99));
  } catch (error) {
    reportError("admin/brands", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }
  const site = process.env.SITE_URL ?? "http://localhost:3000";

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Brands</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          SooulOne is the parent store and each brand has its page on it. A brand can also have its own domain, either sending
          visitors to that page or running as the brand&apos;s own site on the same products and checkout. The footer,
          search and the links between brands all follow these settings.
        </p>
      </div>
      {brands.map((b) => (
        <details key={b.id} className="panel" open={brands.length <= 1}>
          <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-3 px-4 py-3">
            <span className="text-lead font-bold">{b.name}</span>
            <span className="text-small text-ink-soft">
              {MODE_LABEL[b.domainMode]}
              {b.domain && b.domainMode !== "OFF" ? ` · ${b.domain}` : ""}
            </span>
          </summary>
          <div className="border-t border-rule p-4">
            <BrandForm values={b} mainPath={`${site.replace(/\/$/, "")}${brandPath(b.slug)}`} />
          </div>
        </details>
      ))}
    </div>
  );
}
