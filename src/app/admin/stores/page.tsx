import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { StoreForm } from "./store-form";
import { reportError } from "@/lib/observability";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AdminStores() {
  const session = await requirePermission("stores:write");
  if (!session) return <NoAccess />;

  let stores: any[] = [];
  try {
    stores = await db.storeLocation.findMany({ orderBy: { city: "asc" } });
  } catch (error) {
    reportError("admin/stores", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Stores</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          Address, hours and map pin for each superstore. The site never claims live in-store
          stock — listing a store says it carries the range, not that a given item is on the shelf.
        </p>
      </div>

      <StoreForm />

      {stores.length > 0 && (
        <div className="panel">
          {stores.map((s) => (
            <div key={s.id} className="panel-row">
              <span>
                <strong>{s.name}</strong>
                <span className="ml-2 text-ink-faint">{s.city}, {s.state}</span>
              </span>
              <span className="tabular text-ink-faint">{s.postalCode}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
