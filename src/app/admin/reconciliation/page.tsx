import { requireAdmin } from "@/lib/auth";
import { ReconciliationPanel } from "./reconciliation-panel";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const session = await requireAdmin();
  if (!session) return null;

  return (
    <div>
      <h1 className="mb-2 text-h2 font-extrabold">Payment reconciliation</h1>
      <p className="mb-6 max-w-2xl text-small text-ink-soft">
        Cross-checks every Razorpay order in our database against Razorpay&apos;s own records for the
        chosen window, in both directions: orders we think are paid that Razorpay disagrees with, and
        captured payments at Razorpay with no matching local order. The webhook is still the only thing
        that ever marks an order paid — this is a periodic check that its record and ours haven&apos;t
        drifted apart, not a replacement for it.
      </p>
      <ReconciliationPanel />
    </div>
  );
}
