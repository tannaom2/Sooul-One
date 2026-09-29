"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { PINCODE_TAG, SETTINGS_TAG, expireTag } from "@/lib/cache-tags";
import { METHOD_LABEL } from "@/lib/intel/payment-health";
import type { ActionResult } from "./actions";

/**
 * The buttons on insight cards (dashboard and Copilot). Each is a change to
 * the live store, so owner only, logged, and checked here rather than trusted
 * from the card: a card came from rules or from a model, and either way the
 * owner's click is what makes it happen.
 */

const NOT_ALLOWED = "Only the owner can change this. Sign in again if your session ended.";

/** [Disable COD] on an RTO spike: the same rule as Analytics → Pincodes. */
export async function disableCodForPincode(pincode: string): Promise<ActionResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  if (!/^\d{6}$/.test(pincode)) return { ok: false, message: "That isn't a pincode." };
  const before = await db.pincodeRule.findUnique({ where: { pincode } });
  if (before?.codBlocked) return { ok: true, message: `Cash on delivery is already off for ${pincode}.` };
  await db.pincodeRule.upsert({
    where: { pincode },
    create: { pincode, codBlocked: true, note: "Switched off from an RTO insight", updatedBy: session.email },
    update: { codBlocked: true, codAllowed: false, updatedBy: session.email },
  });
  await audit(session, "PINCODE_RULE_SAVE", "PincodeRule", pincode, { codBlocked: { from: before?.codBlocked ?? false, to: true }, via: "insight" });
  expireTag(PINCODE_TAG);
  revalidatePath("/admin");
  revalidatePath("/admin/analytics/pincodes");
  return { ok: true, message: `Cash on delivery is off for ${pincode}. Undo it in Analytics → Pincodes.` };
}

const ADVISORY_ID = (method: string) => `owner:${method}`;

/**
 * [Prioritize backup payment method]: SooulOne has one payment gateway
 * (Razorpay), so there's no second gateway to switch to. What checkout can do
 * is steer shoppers away from the struggling method: a note on it, and
 * another method selected first. Stored like a Razorpay downtime notice, so
 * the same checkout code shows both.
 */
export async function setPaymentAdvisory(method: string, on: boolean): Promise<ActionResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };
  if (!Object.hasOwn(METHOD_LABEL, method) || method === "unknown") return { ok: false, message: "Unknown payment method." };
  const id = ADVISORY_ID(method);
  if (on) {
    await db.paymentDowntime.upsert({
      where: { id },
      create: { id, method, severity: "medium", status: "started", beginAt: new Date(), instrument: { note: "Set by the owner" } },
      update: { status: "started", severity: "medium", beginAt: new Date(), endAt: null },
    });
  } else {
    await db.paymentDowntime.updateMany({ where: { id }, data: { status: "resolved", endAt: new Date() } });
  }
  await audit(session, on ? "PAYMENT_ADVISORY_ON" : "PAYMENT_ADVISORY_OFF", "StoreSettings", id, { method });
  expireTag(SETTINGS_TAG);
  revalidatePath("/admin");
  revalidatePath("/admin/analytics/payments");
  const label = METHOD_LABEL[method];
  return {
    ok: true,
    message: on ? `Checkout now suggests another way to pay instead of ${label}.` : `${label} is back to normal at checkout.`,
  };
}
