import Link from "next/link";
import { redirect } from "next/navigation";
import { getCustomer } from "@/server/customer-auth";
import { accountOrders, checkoutPrefill } from "@/server/customer-account";
import { formatPriceTag } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { SignOutButtons } from "./sign-out-buttons";
import { InviteFriends } from "./invite-friends";
import { accountReferrals, checkoutCredit, isReferred } from "@/server/referrals";
import { ReorderButton } from "@/components/reorder-button";
import { canReorder } from "@/lib/reorder";
import { ReferralCodeEntry } from "@/components/account/referral-code-entry";
import { savedAddresses } from "@/server/saved-addresses";
import { savedBoxes } from "@/server/saved-boxes";
import { addressSummary } from "@/lib/saved-addresses";
import { SavedAddresses, SavedBoxes } from "./saved-lists";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account — SooulOne", robots: { index: false } };

/** In the shopper's words, not the warehouse's (compare STATUS_LABELS in order-lifecycle.ts). */
const STATUS: Record<string, { label: string; tone: "live" | "done" | "off" }> = {
  PENDING_PAYMENT: { label: "Waiting for payment", tone: "live" },
  PAID: { label: "Paid, packing soon", tone: "live" },
  PROCESSING: { label: "Packing", tone: "live" },
  SHIPPED: { label: "On its way", tone: "live" },
  DELIVERED: { label: "Delivered", tone: "done" },
  CANCELLED: { label: "Cancelled", tone: "off" },
  REFUNDED: { label: "Refunded", tone: "off" },
  FAILED: { label: "Payment didn't go through", tone: "off" },
  RTO: { label: "Couldn't be delivered", tone: "off" },
  RETURNED: { label: "Returned", tone: "off" },
};

const TONE = { live: "text-ink font-semibold", done: "text-veg font-semibold", off: "text-ink-faint" } as const;

function formatMobile(phone: string | null) {
  return phone && phone.length === 10 ? `${phone.slice(0, 5)} ${phone.slice(5)}` : (phone ?? "");
}

export default async function AccountPage() {
  const customer = await getCustomer();
  if (!customer) redirect("/account/sign-in");
  const [orders, details, referrals, welcome, referred, addresses, boxes] = await Promise.all([
    accountOrders(customer.id),
    checkoutPrefill(customer),
    accountReferrals(customer.id),
    checkoutCredit(customer.id),
    isReferred(customer.id),
    savedAddresses(customer.id),
    savedBoxes(customer.id),
  ]);
  const siteUrl = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 lg:py-16">
      <p className="text-micro font-semibold tracking-wide text-ink-faint uppercase">Your account</p>
      <h1 className="mt-2 text-h1 font-extrabold">{customer.name ? `Hello, ${customer.name.split(" ")[0]}` : "Hello"}</h1>

      <section className="mt-10">
        <h2 className="font-display text-h3 font-bold">Your orders</h2>
        {orders.length === 0 ? (
          <div className="panel mt-4 p-4 text-small text-ink-soft">
            <p>No orders yet. Orders you place with this number will show here.</p>
            <Link href="/" className="btn btn-outline mt-4">Start shopping</Link>
          </div>
        ) : (
          <ul className="panel mt-4 divide-y divide-rule">
            {orders.map((o) => {
              const status = STATUS[o.status] ?? { label: o.status, tone: "live" as const };
              const more = o.itemCount > 1 ? ` and ${o.itemCount - 1} more` : "";
              return (
                <li key={o.orderNumber} className="flex flex-wrap items-stretch">
                  <Link
                    href={`/order/${encodeURIComponent(o.orderNumber)}${o.accessToken ? `?t=${encodeURIComponent(o.accessToken)}` : ""}`}
                    className="flex min-w-0 flex-1 items-start justify-between gap-4 p-4 hover:bg-shelf"
                  >
                    <span className="min-w-0">
                      <span className={`block text-small ${TONE[status.tone]}`}>{status.label}</span>
                      <span className="mt-0.5 block truncate text-small">
                        {o.firstItem ?? "Order"}
                        {more}
                      </span>
                      <span className="mt-0.5 block text-micro text-ink-faint">
                        <span className="tabular">{o.orderNumber}</span> · {formatDate(o.placedAt)}
                        {o.method === "COD" ? " · Cash on delivery" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tabular block text-small font-semibold">{formatPriceTag(o.totalPaise)}</span>
                      <span className="mt-0.5 block text-micro underline">Track</span>
                    </span>
                  </Link>
                  {canReorder(o.status) && (
                    <div className="flex items-center px-4 pb-4 max-sm:w-full sm:pb-0 sm:pl-0">
                      <ReorderButton orderNumber={o.orderNumber} token={null} className="btn btn-outline max-sm:w-full" />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-display text-h3 font-bold">Your details</h2>
        <dl className="panel mt-4">
          <div className="panel-row">
            <dt>Mobile</dt>
            <dd>
              <span className="tabular">{formatMobile(customer.phone)}</span>
              <span className="ml-2 text-micro text-veg">Verified</span>
            </dd>
          </div>
          {details.email && (
            <div className="panel-row">
              <dt>Receipts go to</dt>
              <dd className="min-w-0 break-all">{details.email}</dd>
            </div>
          )}
        </dl>
        <p className="mt-2 text-micro text-ink-faint">Checkout fills these in for you. Change them there whenever you need to.</p>
      </section>

      {boxes.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-h3 font-bold">Your boxes</h2>
          <SavedBoxes boxes={boxes.map((b) => ({ ...b, picks: [...b.picks], items: [...b.items] }))} />
        </section>
      )}

      {addresses.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-h3 font-bold">Saved addresses</h2>
          <SavedAddresses addresses={addresses.map((a) => ({ id: a.id, summary: addressSummary(a) }))} />
          <p className="mt-2 text-micro text-ink-faint">Saved from your orders. Checkout offers them; a new address is saved when you order.</p>
        </section>
      )}

      {referrals && (
        <section className="mt-10">
          <h2 className="font-display text-h3 font-bold">Invite friends</h2>
          {welcome.credit?.kind === "WELCOME" && (
            <p className="mt-3 border-l-4 border-veg bg-shelf px-3 py-2 text-small">
              {welcome.note}: {formatPriceTag(welcome.credit.amountPaise)} off your first order of {formatPriceTag(welcome.credit.minOrderPaise)} or more, at checkout.
            </p>
          )}
          <div className="mt-4">
            <InviteFriends
              data={{
                link: `${siteUrl}/r/${referrals.code}`,
                code: referrals.code,
                rewardsIssued: referrals.rewardsIssued,
                maxRewards: referrals.maxRewards,
                referrerRewardPaise: referrals.referrerRewardPaise,
                refereeRewardPaise: referrals.refereeRewardPaise,
                minOrderPaise: referrals.minOrderPaise,
                maxCreditPerOrderPaise: referrals.maxCreditPerOrderPaise,
                walletPaise: referrals.walletPaise,
                nextExpiry: referrals.nextExpiry ? { paise: referrals.nextExpiry.paise, on: referrals.nextExpiry.on?.toISOString() ?? null } : null,
                friends: referrals.friends.map((f) => ({ id: f.id, label: f.label, stage: f.stage, done: f.done, holdUntil: f.holdUntil?.toISOString() ?? null })),
              }}
            />
          </div>
          {!referred && orders.length === 0 && referrals.friends.length === 0 && (
            <div className="mt-4">
              <ReferralCodeEntry />
            </div>
          )}
        </section>
      )}

      <section className="mt-10">
        <SignOutButtons />
      </section>
    </div>
  );
}
