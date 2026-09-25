import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { NoAccess } from "@/components/ui";
import { StoreForm } from "../store-form";

export const dynamic = "force-dynamic";

export default async function EditStore({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("stores:write");
  if (!session) return <NoAccess />;

  const { id } = await params;
  const store = await db.storeLocation.findUnique({ where: { id } });
  if (!store) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/stores" className="text-small text-ink-soft hover:underline">
          ← All stores
        </Link>
        <h1 className="mt-2 text-h2 font-extrabold">{store.name}</h1>
      </div>
      <StoreForm store={store} />
    </div>
  );
}
