import Link from "next/link";
import { redirect } from "next/navigation";
import { codeDeliveryHere, getCustomer } from "@/server/customer-auth";
import { SignInClient } from "./sign-in-client";
import { ReferralCodeEntry } from "@/components/account/referral-code-entry";
import { getProgram, rememberedCode } from "@/server/referrals";
import { turnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in — SooulOne", robots: { index: false } };

/** Only a path on this site, so a crafted link can't send a shopper elsewhere after signing in. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/account";
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getCustomer()) redirect(next);
  const available = codeDeliveryHere() !== "off";
  const [program, friendCode] = await Promise.all([getProgram(), rememberedCode()]);

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="text-h1 font-extrabold">Sign in</h1>
      {available ? (
        <>
          <p className="mt-2 text-ink-soft">
            With the mobile number you order with. New here? The same code sets up your account, and orders you placed with
            that number show up straight away.
          </p>
          <div className="mt-8">
            <SignInClient next={next} turnstileSiteKey={turnstileSiteKey()} />
          </div>
          {program.isActive && (
            <div className="mt-8 border-t border-rule pt-6">
              {friendCode ? (
                <p className="text-small text-ink-soft">
                  Your friend&rsquo;s code <strong className="tracking-wider">{friendCode}</strong> is saved: signing in applies it.
                </p>
              ) : (
                <ReferralCodeEntry />
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-ink-soft">Signing in with your mobile number isn&rsquo;t available yet. You can still order as a guest.</p>
          <Link href="/" className="btn btn-outline mt-6">Keep shopping</Link>
        </>
      )}
    </div>
  );
}
