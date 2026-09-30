import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { headers } from "next/headers";
import { PageHeader } from "@/components/ui";
import { getSiteText } from "@/server/site-content";
import { getBusinessProfile } from "@/server/business";
import { findBatches } from "@/server/batch-verify";
import { overLimit } from "@/server/rate-limit";
import { readSessionId } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { reportError } from "@/lib/observability";
import { clientIp, PUBLIC_LIMITS } from "@/lib/rate-limit-rules";
import { normalizeBatch, validBatch, verifyResult, type VerifyResult } from "@/lib/batch-verify";
import { formatBestBefore, formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Check your batch — SooulOne",
  description: "Enter the batch number on your pack to see the product, when it was made and its best-before date.",
  alternates: { canonical: "/verify" },
};

export const dynamic = "force-dynamic";

/**
 * The public batch check (src/lib/batch-verify.ts). A plain GET form, so it
 * works without JavaScript and a QR code on a pack can link straight to a
 * result (/verify?batch=B241007). Capped per connection; the bot guard keeps
 * scripts out. Every check is counted (normalised code and found or not), so
 * the console can show codes that keep failing: a sign of misprints, or fakes.
 */
export default async function Verify({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const { batch } = await searchParams;
  const typed = (batch ?? "").slice(0, 60);
  const [text, business] = await Promise.all([getSiteText(), getBusinessProfile()]);

  let result: VerifyResult | null = null;
  let limited = false;
  let failed = false;
  if (typed.trim()) {
    const normalized = normalizeBatch(typed);
    try {
      limited = await overLimit(`batchCheck:ip:${clientIp(await headers())}`, PUBLIC_LIMITS.batchCheck);
    } catch (error) {
      reportError("verify/rate-limit", error);
    }
    if (!limited) {
      try {
        result = verifyResult(typed, validBatch(normalized) ? await findBatches(normalized) : [], new Date());
        if (result.kind !== "invalid") {
          const found = result.kind === "found";
          const sessionId = (await readSessionId()) ?? "anonymous";
          after(() => recordEvent(sessionId, "BATCH_CHECKED", { metadata: { batch: normalized, found } }));
        }
      } catch (error) {
        reportError("verify", error);
        failed = true;
      }
    }
  }

  const contact = business.customerCareEmail;

  return (
    <>
      <PageHeader title="Check your batch" />
      <div className="mx-auto grid max-w-3xl gap-8 px-5 py-10">
        {text["verify.intro"] && <p className="text-lead text-ink-soft">{text["verify.intro"]}</p>}

        <form action="/verify" className="panel grid gap-3 p-5" role="search" aria-label="Check a batch number">
          <label htmlFor="batch" className="label">
            Batch number
          </label>
          <div className="flex flex-wrap gap-3">
            <input
              id="batch"
              name="batch"
              defaultValue={typed}
              required
              maxLength={40}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. B241007"
              className="field tabular min-w-0 flex-1 uppercase tracking-wider"
              aria-describedby="batch-where"
            />
            <button className="btn btn-solid">Check</button>
          </div>
          {text["verify.where"] && (
            <p id="batch-where" className="text-micro text-ink-soft">
              {text["verify.where"]}
            </p>
          )}
        </form>

        <div role="status" aria-live="polite">
          {limited && <p className="text-alert">You&apos;ve checked a lot of codes in a short time. Wait a few minutes and try again.</p>}
          {failed && <p className="text-alert">We couldn&apos;t check just now. Please try again in a moment.</p>}
          {result?.kind === "invalid" && <p className="text-alert">A batch number is 3 to 30 letters and digits. Check the code on the pack and try again.</p>}
          {result?.kind === "not-found" && (
            <div className="border-l-4 border-caution bg-shelf p-5">
              <p className="text-lead font-bold">We couldn&apos;t find batch {result.batch}.</p>
              <ul className="mt-2 grid list-disc gap-1 pl-5 text-small text-ink-soft">
                <li>Check for look-alike characters: 0 and O, 1 and I, 5 and S, 8 and B.</li>
                <li>Enter only the batch number, not the date next to it.</li>
                <li>
                  Still no match? Send us a photo of the pack{contact ? ` at ${contact}` : ""} and we&apos;ll look into it.{" "}
                  <Link href="/contact#enquiry" className="underline underline-offset-2">
                    Contact us
                  </Link>
                </li>
              </ul>
            </div>
          )}
          {result?.kind === "found" && (
            <div className="grid gap-4">
              {result.matches.map((m) => (
                <div
                  key={`${m.productSlug}-${m.batchNumber}`}
                  className={`border-l-4 bg-shelf p-5 ${m.status === "good" ? "border-veg" : m.status === "expired" ? "border-caution" : "border-alert"}`}
                >
                  <p className="text-lead font-bold">
                    {m.status === "recalled" ? `Batch ${m.batchNumber} has been recalled` : `Batch ${m.batchNumber} is ours`}
                  </p>
                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-small sm:grid-cols-2">
                    <div>
                      <dt className="text-micro text-ink-soft">Product</dt>
                      <dd>
                        <Link href={`/product/${m.productSlug}`} className="font-semibold underline underline-offset-2">
                          {m.productName}
                        </Link>{" "}
                        <span className="text-ink-soft">· {m.brandName}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-micro text-ink-soft">Made on</dt>
                      <dd className="tabular">{formatDate(m.manufacturedOn)}</dd>
                    </div>
                    <div>
                      <dt className="text-micro text-ink-soft">Best before</dt>
                      <dd className="tabular">{formatBestBefore(m.expiresOn)}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-small">
                    {m.status === "good" && "Genuine SooulOne stock, within its best-before date."}
                    {m.status === "expired" && `Genuine SooulOne stock, but this batch passed its best-before date on ${formatBestBefore(m.expiresOn)}. If you bought it recently, contact us.`}
                    {m.status === "recalled" && (
                      <>
                        <strong>Please don&apos;t consume it.</strong> {m.recallNote ?? "Contact us for a replacement or refund."}
                      </>
                    )}
                  </p>
                </div>
              ))}
              {/* What a batch check can and can't prove, said plainly. */}
              <p className="text-micro text-ink-soft">
                A batch check confirms the batch number is ours. If a pack looks wrong (a broken seal, misspelt label, or a price above the MRP),{" "}
                <Link href="/contact#enquiry" className="underline underline-offset-2">
                  tell us
                </Link>{" "}
                with a photo. Buying from our website or our own stores is the surest way to get genuine stock.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
