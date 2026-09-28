import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { activeBoxes } from "@/server/boxes";
import { decimalToPaise } from "@/lib/format";
import { formatPriceTag } from "@/lib/money";
import { boxKindLabel } from "@/lib/checkout/boxes";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Make your own box — SooulOne" };

/** The header's "Make your box" link: straight to the box when there's one, a choice when there are several. */
export default async function BoxesPage() {
  const boxes = await activeBoxes();
  if (boxes.length === 0) notFound();
  if (boxes.length === 1) redirect(`/box/${boxes[0].slug}`);

  return (
    <>
      <PageHeader title="Make your own box" intro="A Box of Gummies or a True Store box: pick any few for one price." />
      <ul className="mx-auto grid max-w-6xl gap-4 px-5 py-12 sm:grid-cols-2">
        {boxes.map((b) => (
          <li key={b.slug}>
            <Link href={`/box/${b.slug}`} className="panel block p-5 hover:border-strong">
              <span className="block text-micro font-semibold tracking-wide text-veg uppercase">{boxKindLabel(b.kind)}</span>
              <span className="mt-1 block font-display text-h3 font-bold">{b.name}</span>
              <span className="mt-1 block text-ink-soft">
                Any {b.size} for {formatPriceTag(decimalToPaise(b.price))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
