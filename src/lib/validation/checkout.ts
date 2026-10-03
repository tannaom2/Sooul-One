import * as z from "zod/mini";

/**
 * Shared between the checkout form (client-side field errors, before a round
 * trip) and create-order/route.ts (the actual authority). One definition
 * means the two can't silently drift apart the way a hand-copied regex would.
 *
 * Written with zod/mini, the tree-shakable build: this file ships to the
 * browser, and full zod added about 95 KB (compressed) to the checkout page.
 */
export const checkoutInputSchema = z.object({
  // Optional (benchmark gap C5): the mobile number is what tracking, sign-in and
  // cash on delivery run on. Blank means no receipt by email.
  email: z.optional(z.union([z.literal(""), z.email({ error: "Check the email address, or leave it blank." })])),
  phone: z.string().check(z.regex(/^[6-9]\d{9}$/, { error: "Enter a 10-digit Indian mobile number." })),
  name: z.string().check(z.minLength(1, { error: "Enter the delivery name." })),
  line1: z.string().check(z.minLength(1, { error: "Enter the address." })),
  line2: z.optional(z.string()),
  city: z.string().check(z.minLength(1, { error: "Enter the city." })),
  state: z.string().check(z.minLength(1, { error: "Enter the state." })),
  postalCode: z.string().check(z.regex(/^\d{6}$/, { error: "Enter a 6-digit pincode." })),
  couponCode: z.optional(z.string().check(z.maxLength(40))),
  paymentMethod: z.enum(["RAZORPAY", "COD"]),
  marketingConsent: z._default(z.boolean(), false),
});

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;
