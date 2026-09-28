"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { clearReferralFlag, rewardReferral, voidReferral } from "@/server/referrals";
import type { ActionResult } from "../actions";

/**
 * The referral programme in the console: its rules, and the referrals that
 * wait for a person (risky, or over the monthly budget). Owner only, since it
 * pays out money; every change and decision is logged.
 */

const NOT_ALLOWED = "Your session expired or you don't have access. Sign in again.";

const rupees = z.coerce.number().min(0).max(10_000);
const programSchema = z.object({
  referrerReward: rupees,
  refereeReward: rupees,
  minOrderValue: z.coerce.number().min(0).max(100_000),
  maxCreditPerOrder: rupees,
  maxRewardsPerReferrer: z.coerce.number().int().min(1).max(100),
  holdDays: z.coerce.number().int().min(0).max(60),
  attributionDays: z.coerce.number().int().min(1).max(365),
  creditExpiryDays: z.coerce.number().int().min(7).max(730),
  riskThreshold: z.coerce.number().int().min(1).max(500),
  monthlyBudget: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).max(10_000_000).nullable()),
});

export async function saveProgram(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  const parsed = programSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Check the numbers: rewards in rupees, days and counts as whole numbers." };
  const d = parsed.data;
  if (d.maxCreditPerOrder > d.minOrderValue) return { ok: false, message: "Credit per order can't be more than the minimum order it needs." };
  if (d.refereeReward > d.minOrderValue) return { ok: false, message: "The friend's discount can't be more than the minimum order it needs." };

  const data = {
    ...d,
    isActive: form.get("isActive") === "on",
    refereeDiscountAfterCap: form.get("refereeDiscountAfterCap") === "on",
  };
  const before = await db.referralProgram.findUnique({ where: { id: "default" } });
  await db.referralProgram.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
  await audit(session, "UPDATE_REFERRAL_PROGRAM", "ReferralProgram", "default", {
    isActive: { from: before?.isActive ?? false, to: data.isActive },
    referrerReward: { from: before ? Number(before.referrerReward) : null, to: d.referrerReward },
    refereeReward: { from: before ? Number(before.refereeReward) : null, to: d.refereeReward },
    minOrderValue: { from: before ? Number(before.minOrderValue) : null, to: d.minOrderValue },
    maxRewardsPerReferrer: { from: before?.maxRewardsPerReferrer ?? null, to: d.maxRewardsPerReferrer },
    monthlyBudget: { from: before?.monthlyBudget == null ? null : Number(before.monthlyBudget), to: d.monthlyBudget },
  });
  revalidatePath("/admin/referrals");
  revalidatePath("/account");
  return { ok: true, message: data.isActive ? "Saved. The programme is running." : "Saved. The programme is off." };
}

export async function decideReferral(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  const id = String(form.get("referralId") ?? "");
  const decision = String(form.get("decision") ?? "");
  const reason = String(form.get("reason") ?? "").trim().slice(0, 200);

  let result;
  if (decision === "review") result = await clearReferralFlag(id, session.email);
  else if (decision === "pay") result = await rewardReferral(id, session.email, { override: true });
  else if (decision === "void") result = await voidReferral(id, reason || "voided_by_admin", session.email);
  else return { ok: false, message: "Choose what to do with this referral." };

  await audit(session, `REFERRAL_${decision.toUpperCase()}`, "Referral", id, { ok: result.ok, reason: reason || null });
  revalidatePath("/admin/referrals");
  return result;
}
