import { z } from "zod";

/**
 * A new discount code, as staff enter it (Admin → Coupons). Codes aren't
 * edited after creation: to change one, switch it off and create another, so
 * orders always point at the terms they were given. Pure, so it's tested.
 */

/** Whole days in India's time zone: a code "valid until 31 Oct" works all of 31 Oct, IST. */
export function startOfDayIST(day: string): Date {
  return new Date(`${day}T00:00:00.000+05:30`);
}
export function endOfDayIST(day: string): Date {
  return new Date(`${day}T23:59:59.999+05:30`);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const couponInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{3,20}$/, "Use 3 to 20 letters and numbers, no spaces, e.g. DIWALI20."),
    discountType: z.enum(["PERCENTAGE", "FLAT"], { message: "Choose percentage or flat amount." }),
    discountValue: z.number({ message: "Enter the discount." }).positive("The discount must be more than zero."),
    minOrderValue: z.number().min(0).optional(),
    maxUses: z.number().int().positive("Leave blank for unlimited, or enter 1 or more.").optional(),
    validFrom: z.string().regex(DAY, "Choose a start date."),
    validUntil: z.string().regex(DAY, "Choose an end date."),
  })
  .superRefine((c, ctx) => {
    if (c.discountType === "PERCENTAGE" && c.discountValue > 90) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "A percentage discount can be at most 90%." });
    }
    if (c.discountType === "FLAT" && c.minOrderValue !== undefined && c.discountValue >= c.minOrderValue) {
      ctx.addIssue({
        code: "custom",
        path: ["discountValue"],
        message: "A flat discount must be smaller than the minimum order it needs.",
      });
    }
    if (c.validUntil < c.validFrom) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "The end date can't be before the start date." });
    }
  });

export type CouponInput = z.infer<typeof couponInputSchema>;

export type CouponStatus = "active" | "scheduled" | "expired" | "used up" | "off";

/** How a code stands today, for the list. */
export function couponStatus(
  c: { isActive: boolean; validFrom: Date; validUntil: Date; maxUses: number | null; usedCount: number },
  now: Date,
): CouponStatus {
  if (!c.isActive) return "off";
  if (c.maxUses !== null && c.usedCount >= c.maxUses) return "used up";
  if (c.validUntil < now) return "expired";
  if (c.validFrom > now) return "scheduled";
  return "active";
}
