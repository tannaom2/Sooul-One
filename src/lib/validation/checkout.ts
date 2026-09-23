import { z } from "zod";

/**
 * Shared between the checkout form (client-side field errors, before a round
 * trip) and create-order/route.ts (the actual authority). One definition
 * means the two can't silently drift apart the way a hand-copied regex would.
 */
export const checkoutInputSchema = z.object({
  email: z.string().email("Enter an email we can send the receipt to."),
  phone: z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number."),
  name: z.string().min(1, "Enter the delivery name."),
  line1: z.string().min(1, "Enter the address."),
  line2: z.string().optional(),
  city: z.string().min(1, "Enter the city."),
  state: z.string().min(1, "Enter the state."),
  postalCode: z.string().regex(/^\d{6}$/, "Enter a 6-digit pincode."),
  couponCode: z.string().max(40).optional(),
  paymentMethod: z.enum(["RAZORPAY", "COD"]),
  marketingConsent: z.boolean().default(false),
});

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;
