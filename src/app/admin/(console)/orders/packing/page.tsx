import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Empty, NoAccess } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { reportError } from "@/lib/observability";
import { daysWaiting } from "@/lib/packing";
import { packingQueue, type QueueOrder } from "@/server/packing";
import { PackingBoard } from "./packing-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packing — SooulOne console" };

/**
 * Orders › Packing: the orders waiting to go, oldest first. Tick a few, and
 * the pick list adds up what to fetch, by product and the batch each unit was
 * set aside from at checkout. Then print the pick list and a packing slip per
 * parcel, and move the paid ones to packing in one go.
 */
export default async function PackingPage() {
  const session = await requirePermission("orders:view");
  if (!session) return <NoAccess />;
  let queue: QueueOrder[] = [];
  try {
    queue = await packingQueue();
  } catch (error) {
    reportError("admin/packing", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }
  const now = new Date();
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-h2 font-extrabold">Packing</h1>
        <p className="mt-1 max-w-[68ch] text-small text-ink-soft">
          Orders waiting to go, oldest first. Tick the ones for this run: the pick list adds up what to fetch, and each parcel gets a
          slip with its address, what&apos;s in it and its batch numbers.
        </p>
      </div>
      {queue.length === 0 ? (
        <Empty title="Nothing to pack" detail="Paid orders appear here, oldest first, until they're marked shipped." />
      ) : (
        <PackingBoard
          canWrite={can(session.role, "orders:write")}
          orders={queue.map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            who: [o.address.name, o.address.city].filter(Boolean).join(" · "),
            items: o.lines.reduce((n, l) => n + l.quantity, 0),
            pays: o.cod ? `Cash ${formatINR(o.totalPaise)}` : `Paid ${formatINR(o.totalPaise)}`,
            waited: daysWaiting(o.placedAt, now),
            lines: o.lines,
          }))}
        />
      )}
    </div>
  );
}
