"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { couponInputSchema, endOfDayIST, startOfDayIST } from "@/lib/validation/coupon";

export interface CouponResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const optionalNumber = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? undefined : Number(s);
};

/** Coupons are money, so the same people who can set prices. */
export async function createCoupon(_prev: CouponResult, form: FormData): Promise<CouponResult> {
  const session = await requirePermission("products:pricing");
  if (!session) return { ok: false, message: "Only the owner or a manager can create discount codes." };

  const parsed = couponInputSchema.safeParse({
    code: String(form.get("code") ?? ""),
    discountType: String(form.get("discountType") ?? ""),
    discountValue: optionalNumber(form.get("discountValue")),
    minOrderValue: optionalNumber(form.get("minOrderValue")),
    maxUses: optionalNumber(form.get("maxUses")),
    validFrom: String(form.get("validFrom") ?? ""),
    validUntil: String(form.get("validUntil") ?? ""),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  const c = parsed.data;

  const existing = await db.coupon.findUnique({ where: { code: c.code }, select: { id: true } });
  if (existing) return { ok: false, message: `The code ${c.code} already exists.`, fieldErrors: { code: "Already used. Choose another code." } };

  try {
    const created = await db.coupon.create({
      data: {
        code: c.code,
        discountType: c.discountType,
        discountValue: c.discountValue,
        minOrderValue: c.minOrderValue ?? null,
        maxUses: c.maxUses ?? null,
        validFrom: startOfDayIST(c.validFrom),
        validUntil: endOfDayIST(c.validUntil),
        isActive: true,
      },
    });
    await audit(session, "CREATE_COUPON", "Coupon", created.id, { ...c });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") {
      return { ok: false, message: `The code ${c.code} was just created by someone else.` };
    }
    throw error;
  }

  revalidatePath("/admin/coupons");
  return { ok: true, message: `${c.code} created. Shoppers can use it at checkout from ${c.validFrom}.` };
}

/** Switch a code off (or back on). Existing orders keep the discount they got. */
export async function setCouponActive(couponId: string, isActive: boolean): Promise<void> {
  const session = await requirePermission("products:pricing");
  if (!session) throw new Error("Not authorized.");
  const coupon = await db.coupon.findUnique({ where: { id: couponId }, select: { code: true, isActive: true } });
  if (!coupon || coupon.isActive === isActive) return;
  await db.coupon.update({ where: { id: couponId }, data: { isActive } });
  await audit(session, isActive ? "ENABLE_COUPON" : "DISABLE_COUPON", "Coupon", couponId, { code: coupon.code });
  revalidatePath("/admin/coupons");
}
