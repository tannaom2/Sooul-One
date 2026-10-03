import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { NoAccess } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { GROUP_LABEL, authorityNoticeDraft, defaultBuyerNotice, type RecipientGroup } from "@/lib/recall";
import { getBusinessProfile } from "@/server/business";
import { loadRecall, noticeTargets, recallKey } from "@/server/recall";
import { db } from "@/lib/db";
import { RecallControl } from "../recall-control";
import { NoticeForm } from "./notice-form";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const GROUPS: RecipientGroup[] = ["hold", "customer", "returned"];

/**
 * One batch's recall: everyone who received it, grouped by what to do (stop
 * the parcel, tell the buyer, set returned packs aside), with the download,
 * the notice to buyers and a draft for the food safety authority
 * (FSSAI Food Recall Procedure Regulations 2017). Contact details are shown,
 * so owner and manager only.
 */
export default async function BatchRecall({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("recalls:manage");
  if (!session) return <NoAccess />;
  const { id } = await params;
  const [loaded, business] = await Promise.all([loadRecall(id), getBusinessProfile()]);
  if (!loaded) notFound();
  const { batch, rows } = loaded;
  const targets = noticeTargets(rows);
  // Buyers already sent this recall's notice, so the button offers only the rest.
  const alreadySent = targets.email.length
    ? await db.outboundMessage.count({ where: { dedupeKey: { in: targets.email.map((r) => recallKey(batch.id, r.orderId)) } } })
    : 0;
  const units = (g: RecipientGroup) => rows.filter((r) => r.group === g).reduce((n, r) => n + r.quantity, 0);
  const manufacturer = batch.product.manufacturer;

  return (
    <div className="grid gap-8">
      <div>
        <Link href="/admin/batches" className="text-small underline">
          ← Stock batches
        </Link>
        <h1 className="mt-2 text-h2 font-extrabold">
          {batch.product.name} <span className="tabular text-ink-soft">{batch.batchNumber}</span>
        </h1>
        <p className="mt-1 text-small text-ink-soft">
          Made {formatDate(batch.manufacturedOn)} · best before {formatDate(batch.expiresOn)} · {batch.quantityReceived} received, {batch.quantityRemaining} in stock
          {batch.supplier ? ` · from ${batch.supplier.name}` : " · supplier not recorded"}
          {batch.invoiceNumber ? ` · invoice ${batch.invoiceNumber}` : ""}
        </p>
        <div className="mt-3">
          <RecallControl batchId={batch.id} batchNumber={batch.batchNumber} recalled={Boolean(batch.recalledAt)} note={batch.recallNote} />
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        {GROUPS.map((g) => (
          <div key={g} className="panel p-4">
            <p className="text-micro text-ink-faint">{GROUP_LABEL[g].title}</p>
            <p className="tabular text-lead font-bold">
              {rows.filter((r) => r.group === g).length} {rows.filter((r) => r.group === g).length === 1 ? "order" : "orders"}
            </p>
            <p className="text-micro text-ink-faint">{units(g)} units</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="who">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="who" className="text-h3 font-bold">
            Who received it
          </h2>
          {rows.length > 0 && (
            <a href={`/admin/batches/${batch.id}/recipients`} className="btn btn-outline">
              Download the list (CSV)
            </a>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="panel p-4 text-small text-ink-soft">No order received this batch.</p>
        ) : (
          GROUPS.filter((g) => rows.some((r) => r.group === g)).map((g) => (
            <div key={g} className="mb-6">
              <h3 className="font-semibold">{GROUP_LABEL[g].title}</h3>
              <p className="mb-2 text-small text-ink-soft">{GROUP_LABEL[g].action}</p>
              <ul className="panel divide-y divide-rule">
                {rows
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <li key={r.orderId} className="grid gap-1 p-3 text-small sm:grid-cols-[1fr_auto]">
                      <span className="min-w-0">
                        <Link href={`/admin/orders/${r.orderId}`} className="tabular font-semibold underline">
                          {r.orderNumber}
                        </Link>
                        <span className="text-ink-soft"> · {r.name || "No name"} · {r.city} {r.pincode}</span>
                        <span className="block text-micro text-ink-faint">
                          {when.format(r.placedAt)} · {r.quantity} {r.quantity === 1 ? "unit" : "units"}
                        </span>
                      </span>
                      <span className="text-micro sm:text-right">
                        <span className="tabular block">{r.phone ?? "No phone"}</span>
                        {r.email ? <span className="block break-all text-ink-soft">{r.email}</span> : g === "customer" && <span className="block font-semibold text-caution">No email: call</span>}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {batch.recalledAt ? (
        <>
          <section aria-labelledby="buyers" className="panel grid gap-3 p-4">
            <h2 id="buyers" className="text-h3 font-bold">
              Tell the buyers
            </h2>
            {can(session.role, "recalls:notify") ? (
              <NoticeForm
                batchId={batch.id}
                initial={batch.recallNoticeText ?? defaultBuyerNotice({ product: batch.product.name, batchNumber: batch.batchNumber, reason: batch.recallNote })}
                toEmail={targets.email.length - alreadySent}
                alreadySent={alreadySent}
                toCall={targets.call.length}
                sentAt={batch.recallNotifiedAt ? when.format(batch.recallNotifiedAt) : null}
              />
            ) : (
              <p className="text-small text-ink-soft">Only the owner can email the notice. Use the list above to call buyers meanwhile.</p>
            )}
          </section>

          <section aria-labelledby="authority" className="panel grid gap-3 p-4">
            <h2 id="authority" className="text-h3 font-bold">
              Notify the food safety authority
            </h2>
            <p className="text-small text-ink-soft">
              A draft from the figures above. Check it, add anything it&apos;s missing, and send it to your Food Safety Officer and
              FSSAI as the Food Recall Procedure Regulations require. Counsel should review it before it goes.
            </p>
            <textarea
              readOnly
              rows={16}
              className="field tabular text-small"
              aria-label="Draft notice to the food safety authority"
              defaultValue={authorityNoticeDraft({
                product: batch.product.name,
                batchNumber: batch.batchNumber,
                manufacturedOn: batch.manufacturedOn,
                expiresOn: batch.expiresOn,
                manufacturer: manufacturer?.name ?? null,
                manufacturerLicence: manufacturer?.fssaiLicence ?? null,
                seller: business.legalName ?? business.tradeName ?? "SooulOne",
                sellerLicence: business.fssaiLicence ?? null,
                reason: batch.recallNote,
                received: batch.quantityReceived,
                remaining: batch.quantityRemaining,
                rows,
              })}
            />
          </section>
        </>
      ) : (
        <p className="text-small text-ink-soft">The notices to buyers and to the authority appear here once the batch is recalled.</p>
      )}
    </div>
  );
}
