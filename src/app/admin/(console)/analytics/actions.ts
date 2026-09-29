"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { diffFields } from "@/lib/audit-diff";
import { PINCODE_TAG, expireTag } from "@/lib/cache-tags";
import { fromPaise } from "@/lib/money";
import type { ActionResult } from "../actions";

/**
 * Owner controls driven by the intelligence reports: a pincode's cash on
 * delivery rule and delivery promise, and monthly marketing spend for
 * acquisition cost. Owner only (settings:manage); every change is logged.
 */

const NOT_ALLOWED = "Only the owner can change this. Sign in again if your session ended.";

const ruleSchema = z.object({
  pincode: z.string().regex(/^\d{6}$/, "Enter a 6-digit pincode."),
  cod: z.enum(["AUTO", "BLOCK", "ALLOW"]),
  extraDays: z.coerce.number().int().min(0).max(14),
  note: z.string().trim().max(200).optional(),
});

export async function savePincodeRule(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  const parsed = ruleSchema.safeParse({
    pincode: form.get("pincode"),
    cod: form.get("cod"),
    extraDays: form.get("extraDays") || 0,
    note: form.get("note") || undefined,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the rule." };
  const { pincode, cod, extraDays, note } = parsed.data;

  const before = await db.pincodeRule.findUnique({ where: { pincode } });
  const data = { codBlocked: cod === "BLOCK", codAllowed: cod === "ALLOW", extraDays, note: note || null, updatedBy: session.email };
  // A rule that says nothing ("automatic", no extra days, no note) is removed.
  if (!data.codBlocked && !data.codAllowed && extraDays === 0 && !data.note) {
    if (!before) return { ok: true, message: "No rule to change." };
    await db.pincodeRule.delete({ where: { pincode } });
    await audit(session, "PINCODE_RULE_CLEAR", "PincodeRule", pincode, { codBlocked: before.codBlocked, codAllowed: before.codAllowed, extraDays: before.extraDays });
  } else {
    await db.pincodeRule.upsert({ where: { pincode }, create: { pincode, ...data }, update: data });
    const changes = diffFields(
      (before ?? { codBlocked: false, codAllowed: false, extraDays: 0, note: null }) as Record<string, unknown>,
      { codBlocked: data.codBlocked, codAllowed: data.codAllowed, extraDays, note: data.note },
    );
    if (Object.keys(changes).length === 0) return { ok: true, message: "No change." };
    await audit(session, "PINCODE_RULE_SAVE", "PincodeRule", pincode, changes);
  }
  expireTag(PINCODE_TAG);
  revalidatePath("/admin/analytics/pincodes");
  return { ok: true, message: `Saved. Checkout uses this for ${pincode} now.` };
}

const spendSchema = z.object({
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, "Pick a month."),
  amount: z.coerce.number().min(0).max(10_000_000),
  note: z.string().trim().max(200).optional(),
});

export async function saveMarketingSpend(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  const parsed = spendSchema.safeParse({ month: form.get("month"), amount: form.get("amount"), note: form.get("note") || undefined });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the amount." };
  const { month, amount, note } = parsed.data;
  const before = await db.marketingSpend.findUnique({ where: { month } });
  const value = fromPaise(Math.round(amount * 100));
  await db.marketingSpend.upsert({ where: { month }, create: { month, amount: value, note: note || null }, update: { amount: value, note: note || null } });
  await audit(session, "MARKETING_SPEND_SAVE", "MarketingSpend", month, { amount: { from: before ? Number(before.amount) : null, to: amount } });
  revalidatePath("/admin/analytics/customers");
  return { ok: true, message: `Saved spend for ${month}.` };
}
