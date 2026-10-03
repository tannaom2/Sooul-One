import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { TOKENS, topBarMessages, type TokenName } from "@/lib/site-content";
import { getStoreFacts } from "@/server/store-settings";
import { TopBar } from "@/components/top-bar";
import { AnnouncementForm } from "./top-bar-editor";

export const dynamic = "force-dynamic";

/**
 * The storefront's top bar. Facts the store already holds are written as
 * {tokens} and filled from the live settings, so the bar can never promise a
 * free-delivery amount checkout doesn't honour.
 */
export default async function TopBarSettings() {
  const session = await requirePermission("settings:manage");
  if (!session) return <NoAccess />;

  let rows: Awaited<ReturnType<typeof db.announcement.findMany>> = [];
  try {
    rows = await db.announcement.findMany({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }] });
  } catch (error) {
    reportError("admin/top-bar", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }
  const facts = await getStoreFacts();
  const nextOrder = rows.length ? Math.max(...rows.map((r) => r.sortOrder)) + 1 : 0;

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Top bar</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          The strip above the menu on every storefront page. Wide screens show every message in one line; phones show one at
          a time. Lead with what could stop someone ordering (where you deliver), then what makes them order more.
        </p>
      </div>

      <section aria-labelledby="preview">
        <h2 id="preview" className="label mb-2">
          Preview, as shoppers see it now
        </h2>
        <div className="border border-rule">
          <TopBar messages={topBarMessages(rows, facts)} />
        </div>
      </section>

      <section aria-labelledby="tokens" className="max-w-[62ch]">
        <h2 id="tokens" className="label mb-2">
          Facts you can drop in
        </h2>
        <p className="mb-2 text-small text-ink-soft">Type these in a message and the site fills in the current value, so it changes when the setting does.</p>
        <dl className="panel">
          {(Object.keys(TOKENS) as TokenName[]).map((t) => (
            <div key={t} className="panel-row">
              <dt>
                <code>{`{${t}}`}</code>
              </dt>
              <dd>{facts[t]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="messages">
        <h2 id="messages" className="mb-3 text-h3 font-bold">
          Messages
        </h2>
        <div className="panel">
          {rows.map((r) => (
            <AnnouncementForm key={`${r.id}-${r.updatedAt.getTime()}`} values={r} />
          ))}
          <AnnouncementForm key={`new-${rows.length}`} values={{ id: null, text: "", href: null, enabled: true, sortOrder: nextOrder }} />
        </div>
      </section>
    </div>
  );
}
