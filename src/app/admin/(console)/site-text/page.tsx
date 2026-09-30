import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { resolveSiteText, type SiteText } from "@/lib/site-content";
import { SiteTextForm } from "./site-text-form";

export const dynamic = "force-dynamic";

/** The storefront's editable lines: contact page, verify page, footer. */
export default async function SiteTextSettings() {
  const session = await requirePermission("settings:manage");
  if (!session) return <NoAccess />;

  let values: SiteText;
  try {
    values = resolveSiteText(await db.siteText.findMany());
  } catch (error) {
    reportError("admin/site-text", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Site text</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          The words on the Contact page, the batch check and the footer. Each starts with a suggested line; change it to
          your own, or empty it to hide it. You can use {"{freeDelivery}"}, {"{deliveryFee}"} and {"{area}"} here too.
        </p>
      </div>
      <SiteTextForm values={values} />
    </div>
  );
}
