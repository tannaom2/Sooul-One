import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { NoAccess } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Downloads — SooulOne console" };

const IST_MS = 5.5 * 60 * 60 * 1000;
/** Today in India time, as yyyy-mm-dd: the default range ends here. */
const todayIst = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);

/**
 * The console's spreadsheets in one place (benchmark gap M2): orders for a
 * date range, and a month's GST register and HSN summary for the accountant.
 * Each download asks for the authenticator code first (it lives under
 * /admin/activity so the activity log's pass covers it) and is logged.
 * Stock is on Stock batches, since it needs neither.
 */
export default async function Downloads() {
  const session = await requirePermission("finance:view");
  if (!session) return <NoAccess />;
  const today = todayIst();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split("-").map(Number);
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;

  return (
    <div className="grid max-w-3xl gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Downloads</h1>
        <p className="mt-2 text-small text-ink-soft">
          Spreadsheets that open in Excel or Google Sheets. They hold customers&apos; details, so each asks for a fresh authenticator code
          first, and every download shows in Activity.
        </p>
      </div>

      <section className="panel p-4">
        <h2 className="font-display text-lead font-bold">Orders</h2>
        <p className="mt-1 text-small text-ink-soft">
          Every order placed in the dates you choose (India time, both days included): status, payment, amounts, the customer&apos;s contact
          and delivery details, courier and invoice. To download particular orders, tick them on the{" "}
          <Link href="/admin/orders" className="underline">
            orders list
          </Link>
          .
        </p>
        <form method="get" action="/admin/activity/export/orders" className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-small">
            <span className="mb-1 block font-medium">From</span>
            <input type="date" name="from" defaultValue={monthStart} max={today} required className="field" />
          </label>
          <label className="text-small">
            <span className="mb-1 block font-medium">To</span>
            <input type="date" name="to" defaultValue={today} max={today} required className="field" />
          </label>
          <button className="btn btn-solid">Download orders</button>
        </form>
      </section>

      <section className="panel p-4">
        <h2 className="font-display text-lead font-bold">GST</h2>
        <p className="mt-1 text-small text-ink-soft">
          A month&apos;s tax invoices, worked out exactly as the printed invoices are. The register has every invoice line with its CGST and
          SGST (or IGST); the HSN summary has the totals per HSN code and rate that GSTR-1 asks for. Invoices are dated the day an order
          ships. Have your accountant check them before filing.
        </p>
        <form method="get" action="/admin/activity/export/gst" className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-small">
            <span className="mb-1 block font-medium">Month</span>
            <input type="month" name="month" defaultValue={lastMonth} max={today.slice(0, 7)} required className="field" />
          </label>
          <button name="kind" value="register" className="btn btn-solid">
            Download GST register
          </button>
          <button name="kind" value="hsn" className="btn btn-outline">
            Download HSN summary
          </button>
        </form>
      </section>

      <p className="text-small text-ink-soft">
        Stock by batch is on{" "}
        <Link href="/admin/batches" className="underline">
          Stock batches
        </Link>
        .
      </p>
    </div>
  );
}
