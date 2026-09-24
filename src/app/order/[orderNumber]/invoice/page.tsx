import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { orderTokenMatches } from "@/lib/order-access";
import { getBusinessProfile } from "@/server/business";
import { TaxInvoice } from "@/components/tax-invoice";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tax invoice", robots: { index: false, follow: false } };

/** The customer's GST invoice: same private link rules as the order page. */
export default async function OrderInvoice({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { orderNumber } = await params;
  const { t } = await searchParams;
  const order = await db.order.findUnique({
    where: { orderNumber },
    include: { items: { include: { product: { select: { hsnCode: true, taxRatePercent: true } } } } },
  });
  if (!order || !orderTokenMatches(t, order.accessToken)) notFound();

  if (!order.invoiceNumber) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16">
        <h1 className="text-h2 font-extrabold">Your invoice isn&apos;t ready yet</h1>
        <p className="mt-2 text-ink-soft">We issue the tax invoice when your order ships. Check back then.</p>
        <Link href={`/order/${order.orderNumber}?t=${t}`} className="mt-6 inline-block underline">
          Back to your order
        </Link>
      </div>
    );
  }
  return <TaxInvoice order={order} seller={await getBusinessProfile()} />;
}
