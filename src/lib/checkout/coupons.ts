/**
 * Whether a discount code can be used right now, and if not, what to tell the
 * shopper. The minimum order value is judged later, in buildQuote, against the
 * order after bundle offers (what the code actually applies to). Pure, so it's
 * tested directly.
 */

export interface CouponRow {
  readonly code: string;
  readonly isActive: boolean;
  readonly validFrom: Date;
  readonly validUntil: Date;
  readonly maxUses: number | null;
  readonly usedCount: number;
}

export type CouponCheck = { readonly ok: true } | { readonly ok: false; readonly message: string };

export function couponValidity(coupon: CouponRow | null, now: Date): CouponCheck {
  if (!coupon || !coupon.isActive) return { ok: false, message: "That code isn't valid." };
  if (coupon.validFrom > now) return { ok: false, message: "That code isn't active yet." };
  if (coupon.validUntil < now) return { ok: false, message: "That code has expired." };
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    return { ok: false, message: "That code has already been used as many times as it allows." };
  }
  return { ok: true };
}

/** "This code needs an order of ₹999 or more. Add ₹150 more to use it." */
export function minimumOrderMessage(minOrderPaise: number, shortfallPaise: number, format: (paise: number) => string): string {
  return `This code needs an order of ${format(minOrderPaise)} or more. Add ${format(shortfallPaise)} more to use it.`;
}
