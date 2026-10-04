import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { reportError } from "@/lib/observability";
import { processMessages, purgeOldMessages } from "@/server/messages";
import { queueRefillReminders } from "@/server/refill-reminders";
import { queueStockAlerts } from "@/server/stock-alerts";

/**
 * The message queue's backstop (src/server/messages.ts), every 5 minutes:
 * sends retries that have come due and anything a request queued but didn't
 * get to send (a crash, a restart), finds orders whose refill reminder is
 * due (src/server/refill-reminders.ts) and back-in-stock requests whose
 * product can ship again (src/server/stock-alerts.ts), and clears out old
 * sent messages.
 * Callers send their own messages straight away, so this is rarely the first
 * try.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ status: "not_configured", reason: "CRON_SECRET unset" }, { status: 503 });
  }
  if (!cronAuthorized(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  const queued = await queueRefillReminders().catch((error) => {
    reportError("cron/refill-reminders", error);
    return 0;
  });
  const stockAlerts = await queueStockAlerts()
    .then((keys) => keys.length)
    .catch((error) => {
      reportError("cron/stock-alerts", error);
      return 0;
    });
  // A few rounds, so a backlog clears without one request running for minutes.
  const counts = { SENT: 0, SKIPPED: 0, PENDING: 0, FAILED: 0 };
  for (let round = 0; round < 4; round++) {
    const done = await processMessages({ limit: 50 });
    for (const d of done) counts[d.outcome.status] += 1;
    if (done.length < 50) break;
  }
  const purged = await purgeOldMessages().catch((error) => {
    reportError("cron/messages-purge", error);
    return 0;
  });
  return NextResponse.json({ status: "ok", refillRemindersQueued: queued, stockAlertsQueued: stockAlerts, sent: counts.SENT, skipped: counts.SKIPPED, retrying: counts.PENDING, failed: counts.FAILED, purged });
}
