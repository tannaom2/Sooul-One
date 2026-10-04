import type { Metadata } from "next";
import { StopButton } from "./stop-button";

export const metadata: Metadata = {
  title: "Stop emails — SooulOne",
  robots: { index: false, follow: false },
};

/**
 * Where "Stop refill reminders" (a reminder email) and "Stop these emails" (a
 * check-in or review request, ?k=follow-ups) land. A button, not the link
 * itself: mail scanners open links to check them, and one shouldn't be able
 * to switch emails off on the shopper's behalf. The order link's token proves
 * it's their order (src/server/order-owner.ts).
 */
export default async function StopReminders({ searchParams }: { searchParams: Promise<{ o?: string; t?: string; k?: string }> }) {
  const { o, t, k } = await searchParams;
  const followUps = k === "follow-ups";
  return (
    <div className="mx-auto max-w-xl px-5 py-16">
      <h1 className="text-h1 font-extrabold">{followUps ? "Stop check-ins and review requests" : "Stop refill reminders"}</h1>
      {o ? (
        <>
          <p className="mt-3 text-lead text-ink-soft">
            {followUps ? (
              <>
                We&apos;ll stop the check-in and review request emails for order <span className="tabular">{o}</span> and any other order with
                the same email or phone. Order updates (confirmation, shipping, delivery, refunds) still come.
              </>
            ) : (
              <>
                We&apos;ll stop the reminder for order <span className="tabular">{o}</span>, and for any other order with the same email. Order
                updates (confirmation, shipping) still come.
              </>
            )}
          </p>
          <StopButton orderNumber={o} token={t ?? null} kind={followUps ? "follow-ups" : "refill"} />
        </>
      ) : (
        <p className="mt-3 text-lead text-ink-soft">This link is missing its order. Use the link in the email, or contact us and we&apos;ll stop them.</p>
      )}
    </div>
  );
}
