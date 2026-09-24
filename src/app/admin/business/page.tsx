import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { BUSINESS_FIELDS } from "@/lib/validation/business";
import { BusinessForm } from "./business-form";

export const dynamic = "force-dynamic";

export default async function BusinessDetails() {
  const session = await requirePermission("settings:manage");
  if (!session) return <NoAccess />;

  let row: Record<string, unknown> | null = null;
  try {
    row = await db.businessProfile.findUnique({ where: { id: "default" } });
  } catch (error) {
    reportError("admin/business", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }
  const values = Object.fromEntries(BUSINESS_FIELDS.map(({ name }) => [name, (row?.[name] as string | null) ?? null]));
  const missing = BUSINESS_FIELDS.filter(({ name }) => name !== "tradeName" && !values[name]);

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Business details</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          Your company&apos;s legal and contact details. They appear in the site footer and on product pages, and are
          printed on every GST invoice. Fill them in as you have them; each is checked for the right format.
        </p>
        {missing.length > 0 && (
          <p className="mt-3 max-w-[62ch] border-l-4 border-caution bg-shelf p-3 text-small">
            Still needed before launch: {missing.map((f) => `${f.group === "Grievance officer" ? "grievance officer " : ""}${f.label.toLowerCase()}`).join(", ")}.
          </p>
        )}
      </div>
      <BusinessForm values={values} />
    </div>
  );
}
