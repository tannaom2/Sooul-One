import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { LICENCE_TYPES, licenceLabel, licenceStatus, type LicenceStatus } from "@/lib/suppliers";
import { SupplierForm, type SupplierValues } from "./supplier-form";

export const dynamic = "force-dynamic";

const TONE: Record<LicenceStatus["state"], string> = {
  missing: "text-alert",
  expired: "text-alert",
  expiring: "text-caution",
  valid: "text-veg",
};

const ymd = (d: Date | null) => (d ? new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10) : null);

/**
 * Suppliers: every firm SooulOne buys from or sells for, with its FSSAI
 * licence (src/lib/suppliers.ts). Products name their manufacturer and
 * packer from here, so the licence number shows on the product page, and
 * batches name the supplier they came from, for recalls.
 */
export default async function Suppliers() {
  const session = await requirePermission("batches:write");
  if (!session) return <NoAccess />;

  let rows: Awaited<ReturnType<typeof load>> = [];
  async function load() {
    return db.supplier.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { _count: { select: { manufactured: { where: { isActive: true } }, marketed: { where: { isActive: true } }, batches: true } } },
    });
  }
  try {
    rows = await load();
  } catch (error) {
    reportError("admin/suppliers", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }
  const now = new Date();
  const withStatus = rows.map((s) => ({ s, status: licenceStatus(s, now) }));
  const needsAction = withStatus.filter((r) => r.s.isActive && r.status.state !== "valid");

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Suppliers</h1>
        <p className="mt-2 max-w-[68ch] text-ink-soft">
          Every firm you buy from or sell for, with its FSSAI licence. Products name their manufacturer here, and its licence
          number shows on the product page; a product can&apos;t go live without it. Batches name the supplier they came from, so
          a recall can be traced back. FSSAI requires buying only from licensed firms and keeping this record.
        </p>
      </div>

      {needsAction.length > 0 && (
        <div className="border-l-4 border-alert bg-shelf px-4 py-3 text-small" role="status">
          <p className="font-semibold">{needsAction.length} {needsAction.length === 1 ? "supplier needs" : "suppliers need"} attention</p>
          <ul className="mt-1 list-disc pl-5">
            {needsAction.map(({ s, status }) => (
              <li key={s.id}>
                {s.name}: {licenceLabel(status)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="panel" open={rows.length === 0}>
        <summary className="cursor-pointer px-4 py-3 font-semibold">Add a supplier</summary>
        <div className="border-t border-rule p-4">
          <SupplierForm />
        </div>
      </details>

      {rows.length === 0 ? (
        <Empty title="No suppliers yet" detail="Add the firms that make your products, with their FSSAI licence numbers." />
      ) : (
        <section className="grid gap-3">
          {withStatus.map(({ s, status }) => {
            const values: SupplierValues = {
              id: s.id,
              name: s.name,
              address: s.address,
              fssaiLicence: s.fssaiLicence,
              licenceType: s.licenceType,
              licenceExpiresOn: ymd(s.licenceExpiresOn),
              gstin: s.gstin,
              contactName: s.contactName,
              contactPhone: s.contactPhone,
              contactEmail: s.contactEmail,
              notes: s.notes,
              isActive: s.isActive,
            };
            const live = s._count.manufactured + s._count.marketed;
            return (
              <details key={s.id} className={`panel ${s.isActive ? "" : "opacity-70"}`}>
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
                  <span className="font-semibold">
                    {s.name}
                    {!s.isActive && <span className="ml-2 text-micro font-normal text-ink-faint">no longer bought from</span>}
                  </span>
                  <span className="text-micro text-ink-soft">
                    <span className={`font-semibold ${TONE[status.state]}`}>{licenceLabel(status)}</span>
                    {s.fssaiLicence && <span className="tabular"> · {s.fssaiLicence}</span>}
                    {s.licenceType && <span> · {LICENCE_TYPES[s.licenceType]}</span>}
                    {` · ${live} live ${live === 1 ? "product" : "products"} · ${s._count.batches} ${s._count.batches === 1 ? "batch" : "batches"}`}
                  </span>
                </summary>
                <div className="border-t border-rule p-4">
                  <SupplierForm values={values} />
                </div>
              </details>
            );
          })}
        </section>
      )}
    </div>
  );
}
