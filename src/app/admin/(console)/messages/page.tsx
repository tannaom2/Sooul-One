import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Empty, NoAccess } from "@/components/ui";
import { Stat } from "@/components/charts";
import { reportError } from "@/lib/observability";
import { MAX_ATTEMPTS, MESSAGE_KINDS, isMessageKind, reasonLabel } from "@/lib/messages";
import { MessageButtons } from "./message-buttons";
import { daysAgo } from "../analytics/format";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

const STATUS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "Waiting", tone: "text-ink-soft" },
  SENDING: { label: "Sending", tone: "text-ink-soft" },
  SENT: { label: "Sent", tone: "text-veg" },
  SKIPPED: { label: "Not sent", tone: "text-ink-faint" },
  FAILED: { label: "Failed", tone: "text-alert" },
  CANCELLED: { label: "Cancelled", tone: "text-ink-faint" },
};

/**
 * Every email the store sends goes through the message queue
 * (src/server/messages.ts): written down first, sent, and retried on failure.
 * This is where a failed one shows, with what went wrong and a retry, and
 * where a waiting refill reminder can be stopped.
 */
export default async function Messages({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requirePermission("orders:view");
  if (!session) return <NoAccess />;
  const canWrite = can(session.role, "orders:write");
  const view = (await searchParams).view === "all" ? "all" : (await searchParams).view === "waiting" ? "waiting" : "attention";

  const since = daysAgo(7);
  let rows: Awaited<ReturnType<typeof load>> = [];
  let counts: Record<string, number> = {};
  async function load() {
    return db.outboundMessage.findMany({
      where:
        view === "attention"
          ? { OR: [{ status: "FAILED" }, { status: "PENDING", attempts: { gt: 0 } }] }
          : view === "waiting"
            ? { status: "PENDING", sendAfter: { gt: new Date() } }
            : {},
      orderBy: view === "waiting" ? { sendAfter: "asc" } : { createdAt: "desc" },
      take: 100,
      select: { id: true, kind: true, status: true, attempts: true, lastError: true, sendAfter: true, sentAt: true, createdAt: true, order: { select: { id: true, orderNumber: true } } },
    });
  }
  try {
    const [list, grouped] = await Promise.all([load(), db.outboundMessage.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } })]);
    rows = list;
    counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  } catch (error) {
    reportError("admin/messages", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  const tab = (v: string, label: string) => (
    <Link
      key={v}
      replace
      href={v === "attention" ? "/admin/messages" : `/admin/messages?view=${v}`}
      aria-current={view === v ? "page" : undefined}
      className={`border px-2 py-1 ${view === v ? "border-ink font-semibold" : "border-rule text-ink-soft"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Messages</h1>
        <p className="mt-2 max-w-[68ch] text-ink-soft">
          Every email the store sends: order confirmations, shipping emails, refill reminders and the alerts to you. A message
          that fails is retried by itself, {MAX_ATTEMPTS} tries over about 15 hours. One that still fails shows here, with what
          went wrong.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Sent, last 7 days" value={String(counts.SENT ?? 0)} />
        <Stat label="Waiting or retrying" value={String((counts.PENDING ?? 0) + (counts.SENDING ?? 0))} />
        <Stat label="Not sent" value={String(counts.SKIPPED ?? 0)} sub="No address, or email isn't set up" />
        <Stat label="Failed" value={String(counts.FAILED ?? 0)} tone={counts.FAILED ? "bad" : undefined} />
      </div>

      <section>
        <nav aria-label="Show" className="mb-3 flex flex-wrap gap-1 text-small">
          {tab("attention", "Needs attention")}
          {tab("waiting", "Scheduled")}
          {tab("all", "All recent")}
        </nav>
        {rows.length === 0 ? (
          <p className="panel p-4 text-small text-ink-soft">
            {view === "attention" ? "Nothing needs attention: every message went, or is on its first try." : view === "waiting" ? "Nothing scheduled for later." : "No messages yet."}
          </p>
        ) : (
          <ul className="panel divide-y divide-rule">
            {rows.map((m) => {
              const status = STATUS[m.status] ?? { label: m.status, tone: "" };
              const later = m.status === "PENDING" && m.sendAfter > new Date();
              return (
                <li key={m.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-start">
                  <div className="min-w-0 text-small">
                    <p>
                      <span className="font-semibold">{isMessageKind(m.kind) ? MESSAGE_KINDS[m.kind] : m.kind}</span>
                      {m.order && (
                        <>
                          {" · "}
                          <Link href={`/admin/orders/${m.order.id}`} className="tabular underline">
                            {m.order.orderNumber}
                          </Link>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-micro text-ink-faint">
                      <span className={`font-semibold ${status.tone}`}>{later ? (m.attempts > 0 ? "Retrying" : "Scheduled") : status.label}</span>
                      {m.attempts > 0 && ` · ${m.attempts} ${m.attempts === 1 ? "try" : "tries"}`}
                      {" · "}
                      {m.sentAt ? `sent ${when.format(m.sentAt)}` : later ? `next ${when.format(m.sendAfter)}` : `queued ${when.format(m.createdAt)}`}
                    </p>
                    {m.lastError && m.status !== "SENT" && <p className="mt-1 text-micro text-ink-soft">{reasonLabel(m.lastError)}</p>}
                  </div>
                  {canWrite && <MessageButtons id={m.id} canRetry={["FAILED", "SKIPPED", "CANCELLED"].includes(m.status)} canCancel={m.status === "PENDING"} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
