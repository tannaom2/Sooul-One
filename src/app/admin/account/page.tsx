import { requirePermission } from "@/lib/auth";
import { NoAccess } from "@/components/ui";
import { recoveryCodeStatus } from "@/server/recovery-codes";
import { RecoveryForm } from "./recovery-form";

export const dynamic = "force-dynamic";

export default async function AccountSecurity({ searchParams }: { searchParams: Promise<{ recovered?: string; welcome?: string }> }) {
  const session = await requirePermission("dashboard:view");
  if (!session) return <NoAccess />;

  const { recovered, welcome } = await searchParams;
  const { remaining, issued } = await recoveryCodeStatus(session.adminUserId);

  return (
    <div className="grid max-w-2xl gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Account security</h1>
        <p className="mt-2 text-ink-soft">Signed in as {session.email}.</p>
      </div>

      {welcome && !issued && (
        <p className="border-l-4 border-caution bg-shelf p-3 text-small">
          <span className="font-semibold">Your authenticator is set up. One last step:</span> make your recovery codes
          below, so losing your phone never locks you out.
        </p>
      )}

      {recovered && (
        <p className="border-l-4 border-caution bg-shelf p-3 text-small">
          You signed in with a recovery code, which can&apos;t be used again. {remaining} left. If your phone is lost for
          good, ask another owner to use <strong>Reset access</strong> on the Team page so you can set up a new
          authenticator, and make a new set of codes afterwards.
        </p>
      )}

      <section className="panel" aria-labelledby="recovery-heading">
        <h2 id="recovery-heading" className="panel-head">
          Recovery codes
        </h2>
        <div className="grid gap-4 p-4">
          <p className="text-small">
            {issued ? (
              <>
                <span className="font-semibold tabular">{remaining} of 10</span> unused.{" "}
                {remaining <= 2 && <span className="text-alert">Make a new set before you run out.</span>}
              </>
            ) : (
              <span className="text-alert">You don&apos;t have recovery codes yet. Without them, losing your phone locks you out.</span>
            )}
          </p>
          <p className="text-small text-ink-soft">
            Each code signs you in once, in place of the 6-digit code, if your phone is lost. They&apos;re shown only when
            made, so keep them in a password manager or on paper.
          </p>
          <RecoveryForm hasCodes={issued} />
        </div>
      </section>
    </div>
  );
}
