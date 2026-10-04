import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { NoAccess } from "@/components/ui";
import { stepUpExpiry } from "@/lib/step-up";
import { turnstileSiteKey } from "@/lib/turnstile";
import { STEP_UP_TTL_SECONDS, safeActivityNext } from "@/lib/step-up-rules";
import { StepUpForm } from "./step-up-form";

export const dynamic = "force-dynamic";



/** The step-up check in front of the activity log and customer exports (src/lib/step-up.ts). */
export default async function VerifyActivityPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await requirePermission("audit:view");
  if (!session) return <NoAccess />;
  const next = safeActivityNext((await searchParams).next);
  if (await stepUpExpiry(session)) redirect(next);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-h2 font-extrabold">Confirm it&apos;s you</h1>
        <p className="mt-2 max-w-[62ch] text-small text-ink-soft">
          The activity log shows everyone&apos;s actions and where they signed in from, so it asks for a fresh code even while
          you&apos;re signed in. Access lasts {STEP_UP_TTL_SECONDS / 60} minutes on this browser, and every try is recorded.
        </p>
      </div>
      {next !== "/admin/activity" && <p className="text-small text-ink-soft">Downloading orders, customers&apos; contact details or the GST register needs the same check.</p>}
      <StepUpForm turnstileSiteKey={turnstileSiteKey()} next={next} />
    </div>
  );
}
