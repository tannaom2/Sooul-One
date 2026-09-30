import Link from "next/link";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { Pager } from "@/components/charts";
import { reportError } from "@/lib/observability";
import { INTEL_PAGE_SIZE, pageCount, parsePage } from "@/lib/intel/paging";
import { ENQUIRY_KINDS } from "@/lib/validation/site-content";
import { EnquiryButtons } from "./enquiry-buttons";
import { daysAgo } from "../analytics/format";

export const dynamic = "force-dynamic";

/** Messages older than this are deleted: personal data kept no longer than it's useful. */
const ENQUIRY_RETENTION_DAYS = 365;

/** India time, as the team reads it: "30 Sept, 4:05 pm". */
const formatDateTime = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const TABS = { new: "New", handled: "Handled", all: "All" } as const;

/** Messages from the Contact page's form, newest first, ten to a page. */
export default async function Enquiries({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const session = await requirePermission("enquiries:manage");
  if (!session) return <NoAccess />;
  const { status: rawStatus, page: rawPage } = await searchParams;
  const status = (rawStatus && rawStatus in TABS ? rawStatus : "new") as keyof typeof TABS;
  const where = status === "all" ? {} : { status: status === "new" ? ("NEW" as const) : ("HANDLED" as const) };

  let total = 0;
  let counts = { NEW: 0, HANDLED: 0 };
  let rows: Awaited<ReturnType<typeof db.enquiry.findMany>> = [];
  let page = 1;
  try {
    const grouped = await db.enquiry.groupBy({ by: ["status"], _count: { _all: true } });
    counts = { NEW: 0, HANDLED: 0, ...Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) };
    total = status === "all" ? counts.NEW + counts.HANDLED : status === "new" ? counts.NEW : counts.HANDLED;
    page = parsePage(rawPage, total);
    rows = await db.enquiry.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * INTEL_PAGE_SIZE, take: INTEL_PAGE_SIZE });
    const cutoff = daysAgo(ENQUIRY_RETENTION_DAYS);
    after(() => db.enquiry.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch((error) => reportError("enquiries/retention", error)));
  } catch (error) {
    reportError("admin/enquiries", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }
  const href = (p: number) => `/admin/enquiries?status=${status}&page=${p}`;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-h2 font-extrabold">Enquiries</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          Messages from the Contact page: collaborations, deliveries outside India and everything else. Reply by email, then
          mark them handled. Messages are deleted after {ENQUIRY_RETENTION_DAYS} days.
        </p>
      </div>

      <nav aria-label="Filter" className="flex gap-2">
        {(Object.keys(TABS) as (keyof typeof TABS)[]).map((t) => (
          <Link
            key={t}
            href={`/admin/enquiries?status=${t}`}
            replace
            aria-current={t === status ? "page" : undefined}
            className={`inline-flex min-h-10 items-center border px-3 text-small ${t === status ? "border-ink font-semibold" : "border-rule text-ink-soft"}`}
          >
            {TABS[t]}
            {t !== "all" && <span className="ml-1.5 tabular">({t === "new" ? counts.NEW : counts.HANDLED})</span>}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <Empty title={status === "new" ? "Nothing waiting" : "No messages here"} detail="New messages from the Contact page land here and are emailed to you." />
      ) : (
        <div className="panel">
          {rows.map((e) => (
            <details key={e.id} className="border-b border-rule last:border-b-0">
              <summary className="grid cursor-pointer gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <span>
                  <span className="font-semibold">{e.name}</span> <span className="text-ink-soft">· {ENQUIRY_KINDS[e.kind]}</span>
                  <span className="mt-0.5 block truncate text-small text-ink-soft">{e.message}</span>
                </span>
                <span className="text-micro text-ink-soft tabular">
                  {formatDateTime(e.createdAt)}
                  {e.status === "HANDLED" && <span className="ml-2 font-semibold text-veg">Handled</span>}
                </span>
              </summary>
              <div className="grid gap-3 border-t border-rule p-4">
                <dl className="grid gap-x-6 gap-y-1 text-small sm:grid-cols-2">
                  <div>
                    <dt className="text-micro text-ink-soft">Email</dt>
                    <dd className="break-all">
                      <a href={`mailto:${e.email}?subject=${encodeURIComponent(`Re: your message to SooulOne`)}`} className="underline underline-offset-2">
                        {e.email}
                      </a>
                    </dd>
                  </div>
                  {e.phone && (
                    <div>
                      <dt className="text-micro text-ink-soft">Phone</dt>
                      <dd className="tabular">{e.phone}</dd>
                    </div>
                  )}
                  {e.organisation && (
                    <div>
                      <dt className="text-micro text-ink-soft">Company or channel</dt>
                      <dd>{e.organisation}</dd>
                    </div>
                  )}
                  {e.country && (
                    <div>
                      <dt className="text-micro text-ink-soft">Deliver to</dt>
                      <dd>{e.country}</dd>
                    </div>
                  )}
                </dl>
                <p className="max-w-[68ch] whitespace-pre-line">{e.message}</p>
                {e.handledBy && (
                  <p className="text-micro text-ink-soft">
                    Handled by {e.handledBy}
                    {e.handledAt ? ` on ${formatDateTime(e.handledAt)}` : ""}
                  </p>
                )}
                <EnquiryButtons id={e.id} handled={e.status === "HANDLED"} />
              </div>
            </details>
          ))}
        </div>
      )}
      {pageCount(total) > 1 && <Pager page={page} pages={pageCount(total)} href={href} label="Enquiry pages" />}
    </div>
  );
}
