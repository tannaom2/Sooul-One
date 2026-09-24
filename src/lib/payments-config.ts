/**
 * Whether online payment can actually complete on this deployment. All three
 * are needed: the key pair to open Razorpay's checkout, and the webhook secret,
 * because the webhook is the only thing that marks an order paid. Without it a
 * shopper could pay and the order would sit unpaid until the expiry sweep
 * cancelled it.
 */
export function onlinePaymentsEnabled(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET);
}
