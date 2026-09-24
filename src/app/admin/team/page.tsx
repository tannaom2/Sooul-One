import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { ROLES } from "@/lib/permissions";
import { NoAccess } from "@/components/ui";
import { AddMemberForm, MemberControls } from "./team-forms";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export default async function TeamPage() {
  const session = await requirePermission("team:manage");
  if (!session) return <NoAccess />;

  const members = await db.adminUser.findMany({
    select: { id: true, name: true, email: true, role: true, isActive: true, mfaSecret: true, lastLoginAt: true },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
  const roles = ROLES.map((r) => ({ ...r }));
  const label = (role: string) => ROLES.find((r) => r.role === role)?.label ?? role;

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Team</h1>
        <p className="mt-2 max-w-[62ch] text-small text-ink-soft">
          Give each person only the access their job needs. Changes take effect on their next click, and every change
          is recorded in Activity.
        </p>
      </div>

      <section className="panel p-4">
        <h2 className="mb-3 font-semibold">Add someone</h2>
        <AddMemberForm roles={roles} />
      </section>

      <section className="panel">
        {members.map((m) => {
          const isYou = m.id === session.adminUserId;
          const pending = !m.mfaSecret;
          return (
            <div
              key={m.id}
              className="grid gap-3 border-b border-[--color-rule] px-4 py-4 last:border-b-0 lg:grid-cols-[1fr_auto] lg:items-center"
              style={m.isActive ? undefined : { opacity: 0.6 }}
            >
              <div className="min-w-0 text-small">
                <p>
                  <span className="font-semibold">{m.name}</span>
                  {isYou && <span className="ml-2 text-micro text-ink-faint">(you)</span>}
                  {!m.isActive && <span className="ml-2 text-micro font-semibold text-alert">deactivated</span>}
                  {m.isActive && pending && (
                    <span className="ml-2 text-micro font-semibold" style={{ color: "var(--color-caution)" }}>
                      setup pending
                    </span>
                  )}
                </p>
                <p className="break-all text-ink-soft">{m.email}</p>
                <p className="text-micro text-ink-faint">
                  {label(m.role)} · {m.lastLoginAt ? `last signed in ${when.format(m.lastLoginAt)}` : "never signed in"}
                </p>
              </div>
              {isYou ? (
                <p className="text-micro text-ink-faint lg:text-right">
                  Another owner can change your account.
                </p>
              ) : (
                <MemberControls id={m.id} name={m.name} role={m.role} isActive={m.isActive} roles={roles} />
              )}
            </div>
          );
        })}
      </section>

      <section>
        <h2 className="mb-3 text-h3 font-bold">What each role can do</h2>
        <dl className="panel">
          {ROLES.map((r) => (
            <div key={r.role} className="panel-row">
              <dt className="font-semibold">{r.label}</dt>
              <dd className="text-right text-ink-soft">{r.description}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
