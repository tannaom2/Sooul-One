import { MAX_LINE_QUANTITY } from "@/lib/basket-types";

/**
 * What happens to the basket when a shopper signs in (src/server/cart.ts
 * basketOnSignIn). The account keeps one basket, so one started on the phone
 * is there on the laptop: signing in on a browser brings that browser's guest
 * basket into the account's, and the browser then uses the account's.
 *
 * At checkout ("keep") nothing is merged or swapped: the shopper is placing
 * the order they're looking at, and an old basket from another device must
 * never slip into it. A browser's basket that belongs to someone else's
 * account (a shared computer) is never merged into this one. Pure, tested
 * (tests/basket-sign-in.test.ts).
 */
export type SignInBasketMode = "follow" | "keep";

export type SignInBasketPlan =
  | { readonly kind: "none" }
  /** This browser's guest basket becomes the account's. */
  | { readonly kind: "claim"; readonly cartId: string }
  /** Move this browser's guest basket into the account's, then use the account's here. */
  | { readonly kind: "merge"; readonly from: string; readonly into: string }
  /** Use the account's basket here (this browser had none of its own to bring). */
  | { readonly kind: "use"; readonly cartId: string }
  /** This browser holds another account's basket: start an empty one here. */
  | { readonly kind: "fresh" };

export function planSignInBasket(
  here: { id: string; customerId: string | null } | null,
  account: { id: string } | null,
  customerId: string,
  mode: SignInBasketMode,
): SignInBasketPlan {
  const someoneElses = here !== null && here.customerId !== null && here.customerId !== customerId;
  if (here && here.customerId === customerId) return { kind: "none" };
  if (mode === "keep") return here && !someoneElses && !account ? { kind: "claim", cartId: here.id } : { kind: "none" };
  if (!account) {
    if (someoneElses) return { kind: "fresh" };
    return here ? { kind: "claim", cartId: here.id } : { kind: "none" };
  }
  if (here && !someoneElses) return { kind: "merge", from: here.id, into: account.id };
  return { kind: "use", cartId: account.id };
}

/** A product in both baskets: the two quantities together, within the per-line limit. */
export function mergedQuantity(account: number, guest: number): number {
  return Math.min(MAX_LINE_QUANTITY, Math.max(0, account) + Math.max(0, guest));
}
