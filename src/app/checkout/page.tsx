import { connection } from "next/server";
import { getCheckoutState } from "@/server/store-settings";
import { codRequiresCode, getCustomer } from "@/server/customer-auth";
import { checkoutPrefill } from "@/server/customer-account";
import { savedAddresses } from "@/server/saved-addresses";
import { getCodSettings, getDownMethods } from "@/server/intel";
import { turnstileSiteKey } from "@/lib/turnstile";
import { CheckoutClient } from "./checkout-client";

/**
 * Server entry for checkout: decides at request time (not build time) whether
 * checkout is open (launch gate, owner's pause) and which payment methods it
 * can take (Razorpay set up, cash on delivery switched on). create-order
 * enforces the same rules (src/lib/store-controls.ts).
 *
 * A signed-in shopper's details come pre-filled from their last order, and
 * their proven number needs no code for cash on delivery.
 */
export default async function CheckoutPage() {
  await connection();
  const [state, customer, cod, downMethods] = await Promise.all([getCheckoutState(), getCustomer(), getCodSettings(), getDownMethods()]);
  const [prefill, addresses] = customer ? await Promise.all([checkoutPrefill(customer), savedAddresses(customer.id)]) : [{}, []];
  // The form renders once the browser has restored any draft, and the summary once
  // the first quote is back; holding the height stops the footer jumping meanwhile.
  return (
    <div className="min-h-[85svh]">
      <CheckoutClient
        state={state}
        account={{
          phone: customer?.phone ?? null,
          prefill,
          codNeedsCode: codRequiresCode(),
          addresses: addresses.map((a) => ({ id: a.id, name: a.name, line1: a.line1, line2: a.line2, city: a.city, state: a.state, postalCode: a.postalCode })),
        }}
        preferredPayment={cod.preferredPayment}
        turnstileSiteKey={turnstileSiteKey()}
        downMethods={downMethods}
      />
    </div>
  );
}
