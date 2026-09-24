import { getStores } from "@/server/catalog";
import { Empty, PageHeader } from "@/components/ui";
import { reportError } from "@/lib/observability";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Find a store — SooulOne",
  description: "Our True Store superstores: address, opening hours and the brands each one carries.",
};

export default async function Stores() {
  let stores: Awaited<ReturnType<typeof getStores>> = [];
  try {
    stores = await getStores();
  } catch (error) {
    reportError("stores", error);
    stores = [];
  }

  return (
    <>
      <PageHeader
        title="Find a store"
        intro="Addresses, hours and the brands each superstore carries. We don't show live in-store stock — a listing here means the store carries the range, not that a specific item is on the shelf right now."
      />

      <section className="mx-auto max-w-6xl px-5 py-12">
        {stores.length > 0 ? (
          <ul className="grid gap-px border border-[--color-rule] bg-[--color-rule] sm:grid-cols-2">
            {stores.map((s: { id: string; name: string; addressLine1: string; addressLine2: string | null; city: string; state: string; postalCode: string; phone: string | null; openingHours: string | null; latitude: number | null; longitude: number | null }) => (
              <li key={s.id} className="bg-paper p-6">
                <h2 className="text-h3 font-bold">{s.name}</h2>
                <address className="mt-2 not-italic text-small text-ink-soft">
                  {s.addressLine1}
                  {s.addressLine2 && <>, {s.addressLine2}</>}
                  <br />
                  {s.city}, {s.state} <span className="tabular">{s.postalCode}</span>
                </address>
                {s.openingHours && <p className="mt-3 text-small">{s.openingHours}</p>}
                {s.phone && (
                  <p className="mt-1 text-small tabular">
                    <a href={`tel:${s.phone}`} className="underline">
                      {s.phone}
                    </a>
                  </p>
                )}
                {s.latitude !== null && s.longitude !== null && (
                  <a
                    className="mt-3 inline-block text-small font-semibold underline"
                    href={`https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open in maps
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty
            title="No stores listed yet"
            detail="Add your superstore addresses and hours from the owner console and they will appear here."
          />
        )}
      </section>
    </>
  );
}
