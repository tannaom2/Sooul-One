import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { JobForm } from "./job-form";

export const dynamic = "force-dynamic";

/** Open roles for /careers and the Contact page's careers block (hidden while none is published). */
export default async function Careers() {
  const session = await requirePermission("content:write");
  if (!session) return <NoAccess />;

  let jobs: Awaited<ReturnType<typeof db.jobOpening.findMany>> = [];
  try {
    jobs = await db.jobOpening.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
  } catch (error) {
    reportError("admin/careers", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }
  const live = jobs.filter((j) => j.published).length;

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Careers</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          {live === 0
            ? "No role is published, so the site doesn't mention careers. Publish one and the Contact page and footer link to /careers."
            : `${live} ${live === 1 ? "role is" : "roles are"} live on /careers.`}
        </p>
      </div>
      <details className="panel p-4" open={jobs.length === 0}>
        <summary className="cursor-pointer font-semibold">Add a role</summary>
        <div className="mt-4">
          <JobForm values={{ id: null, title: "", team: null, location: "", employmentType: "Full-time", summary: "", applyUrl: null, applyEmail: null, sortOrder: 0, published: false }} />
        </div>
      </details>
      {jobs.length > 0 && (
        <div className="panel">
          {jobs.map((j) => (
            <details key={j.id} className="border-b border-rule last:border-b-0">
              <summary className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
                <span className="font-semibold">
                  {j.title} <span className="font-normal text-ink-soft">· {j.location}</span>
                </span>
                <span className={`text-micro font-semibold ${j.published ? "text-veg" : "text-caution"}`}>{j.published ? "Published" : "Draft"}</span>
              </summary>
              <div className="border-t border-rule p-4">
                <JobForm key={j.updatedAt.getTime()} values={j} />
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
