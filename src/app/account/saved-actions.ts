"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { reportError } from "@/lib/observability";
import { getCustomer } from "@/server/customer-auth";
import { removeSavedBox, saveBoxForCustomer } from "@/server/saved-boxes";
import { forgetAddress } from "@/server/saved-addresses";

/**
 * The signed-in shopper's saved boxes and addresses (benchmark gaps R4, C16).
 * Each acts only on the caller's own account; an id that isn't theirs does
 * nothing.
 */

export interface SavedResult {
  ok: boolean;
  message: string;
  /** Set when the shopper needs to sign in first. */
  signIn?: true;
}

const NOT_SIGNED_IN: SavedResult = { ok: false, message: "Sign in to save boxes and addresses.", signIn: true };
const TRY_AGAIN: SavedResult = { ok: false, message: "That didn't save. Try again in a moment." };

const boxInput = z.object({
  boxId: z.string().min(1).max(40),
  name: z.string().max(200),
  picks: z.array(z.object({ productId: z.string().min(1).max(40), quantity: z.number().int().min(1).max(10) })).min(1).max(12),
});

/** "Save this box for next time", after a finished box goes in the basket. */
export async function saveMyBox(input: { boxId: string; name: string; picks: { productId: string; quantity: number }[] }): Promise<SavedResult> {
  const customer = await getCustomer();
  if (!customer) return NOT_SIGNED_IN;
  const parsed = boxInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That box couldn't be saved. Reload the page and try again." };
  try {
    const saved = await saveBoxForCustomer(customer.id, parsed.data);
    if (!saved.ok) return saved;
    revalidatePath("/account");
    return { ok: true, message: "Saved to your account. Add it to your basket from there any time." };
  } catch (error) {
    reportError("saved-box/save", error);
    return TRY_AGAIN;
  }
}

const id = z.string().min(1).max(40);

export async function removeMyBox(savedBoxId: string): Promise<SavedResult> {
  const customer = await getCustomer();
  if (!customer) return NOT_SIGNED_IN;
  if (!id.safeParse(savedBoxId).success) return TRY_AGAIN;
  try {
    await removeSavedBox(customer.id, savedBoxId);
    revalidatePath("/account");
    return { ok: true, message: "Removed." };
  } catch (error) {
    reportError("saved-box/remove", error);
    return TRY_AGAIN;
  }
}

export async function removeMyAddress(addressId: string): Promise<SavedResult> {
  const customer = await getCustomer();
  if (!customer) return NOT_SIGNED_IN;
  if (!id.safeParse(addressId).success) return TRY_AGAIN;
  try {
    await forgetAddress(customer.id, addressId);
    revalidatePath("/account");
    revalidatePath("/checkout");
    return { ok: true, message: "Removed." };
  } catch (error) {
    reportError("address-book/remove", error);
    return TRY_AGAIN;
  }
}
