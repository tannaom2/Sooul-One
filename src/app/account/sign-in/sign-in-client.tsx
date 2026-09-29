"use client";

import { useRouter } from "next/navigation";
import { PhoneCodeForm } from "@/components/account/phone-code-form";

export function SignInClient({ next, turnstileSiteKey = null }: { next: string; turnstileSiteKey?: string | null }) {
  const router = useRouter();
  return (
    <PhoneCodeForm
      turnstileSiteKey={turnstileSiteKey}
      submitLabel="Sign in"
      onVerified={() => {
        // Replace, so Back doesn't return to a sign-in form that's done its job.
        router.replace(next);
        router.refresh();
      }}
    />
  );
}
