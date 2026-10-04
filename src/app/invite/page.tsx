import Link from "next/link";
import { getCustomer } from "@/server/customer-auth";
import { invite, rememberedCode } from "@/server/referrals";
import { formatPriceTag } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "You've been invited", robots: { index: false } };

/** Where a friend's link lands: whose invitation, what it's worth, and how to use it. */
export default async function InvitePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const code = (await searchParams).code ?? (await rememberedCode());
  const offer = code ? await invite(code) : null;
  const customer = await getCustomer();

  if (!offer) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16">
        <h1 className="text-h1 font-extrabold">This invitation has ended</h1>
        <p className="mt-2 text-ink-soft">The link may be old, or the offer isn&rsquo;t running just now. Everything is still here to shop.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/true-store" className="btn btn-solid">Shop The True Store</Link>
          <Link href="/gummies" className="btn btn-outline">Shop gummies</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-5 py-16">
      <p className="text-micro font-semibold tracking-wide text-veg uppercase">An invitation from {offer.referrer}</p>
      <h1 className="mt-2 text-h1 font-extrabold">{formatPriceTag(offer.refereeRewardPaise)} off your first order</h1>
      <p className="mt-3 text-lead text-ink-soft">
        {offer.referrer} thinks you&rsquo;ll like our snacks and gummies, with every label in full before you buy. Your first order of{" "}
        {formatPriceTag(offer.minOrderPaise)} or more is {formatPriceTag(offer.refereeRewardPaise)} less.
      </p>
      <ol className="mt-6 grid gap-2 text-small">
        <li><strong>1.</strong> Fill your basket: the offer counts the total after any combo or box savings.</li>
        <li><strong>2.</strong> Sign in with your mobile number (a 6-digit code, no password). New here? That sets up your account.</li>
        <li><strong>3.</strong> The {formatPriceTag(offer.refereeRewardPaise)} comes off at checkout. It can&rsquo;t be combined with a discount code.</li>
      </ol>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/true-store" className="btn btn-solid">Start shopping</Link>
        {!customer && (
          <Link href="/account/sign-in?next=/true-store" className="btn btn-outline">Sign in first</Link>
        )}
      </div>
      <p className="mt-6 text-micro text-ink-faint">
        For first orders only, one per person and phone number. Your code {offer.code} is saved on this device for 30 days.
      </p>
    </div>
  );
}
