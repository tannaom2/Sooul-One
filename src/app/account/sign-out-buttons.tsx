"use client";

import { CHECKOUT_DRAFT_KEY } from "@/app/checkout/use-checkout";
import { signOut, signOutEverywhere } from "./actions";

/**
 * Signing out also forgets this tab's checkout draft, which checkout filled
 * from the account: the next person at this browser shouldn't find it.
 */
function forgetDraft() {
  try {
    sessionStorage.removeItem(CHECKOUT_DRAFT_KEY);
  } catch {}
}

export function SignOutButtons() {
  return (
    <div className="flex flex-wrap gap-3">
      <form action={signOut} onSubmit={forgetDraft}>
        <button type="submit" className="btn btn-outline">Sign out</button>
      </form>
      <form action={signOutEverywhere} onSubmit={forgetDraft}>
        <button type="submit" className="btn btn-outline">Sign out on every device</button>
      </form>
    </div>
  );
}
