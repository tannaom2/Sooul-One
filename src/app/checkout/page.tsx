import { connection } from "next/server";
import { onlinePaymentsEnabled } from "@/lib/payments-config";
import { CheckoutClient } from "./checkout-client";

/**
 * Server entry for checkout: decides at request time (not build time) which
 * payment methods this deployment can actually complete, so UPI and card only
 * appear once Razorpay is fully configured. create-order enforces the same rule.
 */
export default async function CheckoutPage() {
  await connection();
  return <CheckoutClient onlinePayments={onlinePaymentsEnabled()} />;
}
