import type { Metadata } from "next";
import { StopButton } from "./stop-button";

export const metadata: Metadata = {
  title: "Stop refill reminders — SooulOne",
  robots: { index: false, follow: false },
};

/**
 * Where "Stop refill reminders" in a reminder email lands. A button, not the
 * link itself: mail scanners open links to check them, and one shouldn't be
 * able to switch reminders off on the shopper's behalf. The order link's
 * token proves it's their order (src/app/order/[orderNumber]/refill-actions.ts).
 */
export default async function StopReminders({ searchParams }: { searchParams: Promise<{ o?: string; t?: string }> }) {
  const { o, t } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-5 py-16">
      <h1 className="text-h1 font-extrabold">Stop refill reminders</h1>
      {o ? (
        <>
          <p className="mt-3 text-lead text-ink-soft">
            We&apos;ll stop the reminder for order <span className="tabular">{o}</span>, and for any other order with the same
            email. Order updates (confirmation, shipping) still come.
          </p>
          <StopButton orderNumber={o} token={t ?? null} />
        </>
      ) : (
        <p className="mt-3 text-lead text-ink-soft">This link is missing its order. Use the link in the reminder email, or contact us and we&apos;ll stop them.</p>
      )}
    </div>
  );
}
