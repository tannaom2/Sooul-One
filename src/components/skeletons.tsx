/**
 * Page shapes shown the instant a link is tapped, while the server prepares
 * the real page (F4). The database sits far from the app server, so an
 * uncached page can take a moment; a skeleton in the page's own shape says
 * "it's coming" instead of leaving the old page frozen. Each loading.tsx
 * picks the shape that matches its page. Pulsing only for people who
 * haven't asked their device for reduced motion.
 *
 * Only on pages that can't be "not found". A loading.tsx makes the page
 * stream, so the response has started (status 200) before the page can call
 * notFound(): a removed product would answer 200 instead of 404. Pages
 * addressed by a slug (products, brands, boxes, policies, articles) need
 * their existence checked before any skeleton, inside the page.
 */

const block = "rounded bg-shelf motion-safe:animate-pulse";

function Bar({ className }: { className: string }) {
  return <div className={`${block} ${className}`} />;
}

/** The PageHeader band most storefront pages open with. */
function HeaderBand() {
  return (
    <div className="border-b border-rule bg-shelf/60">
      <div className="mx-auto grid max-w-6xl gap-3 px-5 py-12">
        <Bar className="h-10 w-64 max-w-full" />
        <Bar className="h-5 w-[32rem] max-w-full" />
      </div>
    </div>
  );
}

function Status({ label }: { label: string }) {
  return (
    <p role="status" className="sr-only">
      {label}
    </p>
  );
}

/** A listing: header, filter chips and a grid of product cards. */
export function ListingSkeleton({ label = "Loading products" }: { label?: string }) {
  return (
    <div aria-busy="true">
      <Status label={label} />
      <HeaderBand />
      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Bar key={i} className="h-8 w-24" />
          ))}
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="grid gap-3 border border-rule p-4">
              <Bar className="aspect-[4/3] w-full" />
              <Bar className="h-5 w-3/4" />
              <Bar className="h-4 w-1/2" />
              <Bar className="h-6 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A reading page: header band and paragraphs (help, learn, contact, policies). */
export function TextPageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div aria-busy="true">
      <Status label={label} />
      <HeaderBand />
      <div className="mx-auto grid max-w-3xl gap-3 px-5 py-10">
        {["w-full", "w-11/12", "w-full", "w-4/5", "w-full", "w-2/3"].map((w, i) => (
          <Bar key={i} className={`h-4 ${w}`} />
        ))}
        <Bar className="mt-6 h-24 w-full" />
      </div>
    </div>
  );
}
