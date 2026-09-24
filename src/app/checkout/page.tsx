import { connection } from "next/server";
import { getCheckoutState } from "@/server/store-settings";
import { CheckoutClient } from "./checkout-client";

/**
 * Server entry for checkout: decides at request time (not build time) whether
 * checkout is open (launch gate, owner's pause) and which payment methods it
 * can take (Razorpay set up, cash on delivery switched on). create-order
 * enforces the same rules (src/lib/store-controls.ts).
 */
export default async function CheckoutPage() {
  await connection();
  return <CheckoutClient state={await getCheckoutState()} />;
}
