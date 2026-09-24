import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { NoAccess } from "@/components/ui";
import { getBusinessProfile } from "@/server/business";
import { TaxInvoice } from "@/components/tax-invoice";

export const dynamic = "force-dynamic";

export default async function AdminOrderInvoice({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("orders:view");
  if (!session) return <NoAccess />;

  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: { items: { include: { product: { select: { hsnCode: true, taxRatePercent: true } } } } },
  });
  if (!order?.invoiceNumber) notFound();
  return <TaxInvoice order={order} seller={await getBusinessProfile()} />;
}
