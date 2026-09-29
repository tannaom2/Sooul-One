"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { diffFields } from "@/lib/audit-diff";
import { SETTINGS_TAG, expireTag } from "@/lib/cache-tags";
import { allowedCopilotUrl } from "@/server/copilot";
import type { ActionResult } from "../actions";

const NOT_ALLOWED = "Only the owner can change assistant settings.";

/** The storefront assistant: on or off, and the business's own return rules and WhatsApp number. */
export async function saveAssistantSettings(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };

  const windowRaw = String(form.get("returnWindowDays") ?? "").trim();
  const returnWindowDays = windowRaw === "" ? null : Math.floor(Number(windowRaw));
  if (returnWindowDays !== null && !(returnWindowDays >= 0 && returnWindowDays <= 60)) {
    return { ok: false, message: "Enter a return window of 0 to 60 days, or leave it blank." };
  }
  const returnConditions = String(form.get("returnConditions") ?? "").trim() || null;
  if (returnConditions && returnConditions.length > 600) return { ok: false, message: "Keep the return conditions under 600 characters." };
  const digits = String(form.get("supportWhatsapp") ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (digits && !/^[6-9]\d{9}$/.test(digits)) return { ok: false, message: "Enter a 10-digit Indian mobile number for WhatsApp, or leave it blank." };

  const data = { assistantEnabled: form.get("assistantEnabled") === "on", returnWindowDays, returnConditions, supportWhatsapp: digits || null };
  const before = await db.storeSettings.findUnique({
    where: { id: "default" },
    select: { assistantEnabled: true, returnWindowDays: true, returnConditions: true, supportWhatsapp: true },
  });
  await db.storeSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
  const changes = diffFields((before ?? { assistantEnabled: true, returnWindowDays: null, returnConditions: null, supportWhatsapp: null }) as Record<string, unknown>, data);
  if (Object.keys(changes).length === 0) return { ok: true, message: "No change." };
  await audit(session, "UPDATE_ASSISTANT", "StoreSettings", "default", changes);
  expireTag(SETTINGS_TAG);
  revalidatePath("/admin/assistants");
  return { ok: true, message: "Saved. The storefront assistant uses these now." };
}

/**
 * The local copilot's tunnel address and shared token. The token is never
 * shown back or written to the activity log, only whether it changed.
 */
export async function saveCopilotSettings(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: NOT_ALLOWED };

  if (form.get("disconnect") === "on") {
    await db.storeSettings.upsert({ where: { id: "default" }, create: { id: "default" }, update: { copilotUrl: null, copilotToken: null } });
    await audit(session, "COPILOT_DISCONNECT", "StoreSettings", "default");
    revalidatePath("/admin/assistants");
    return { ok: true, message: "Disconnected. Insights use the built-in rules." };
  }

  const rawUrl = String(form.get("copilotUrl") ?? "").trim();
  const check = allowedCopilotUrl(rawUrl);
  if (!check.ok) return { ok: false, message: check.reason };
  const token = String(form.get("copilotToken") ?? "").trim();
  const before = await db.storeSettings.findUnique({ where: { id: "default" }, select: { copilotUrl: true, copilotToken: true } });
  if (!token && !before?.copilotToken) return { ok: false, message: "Paste the token the copilot printed when it started (COPILOT_TOKEN)." };
  // A different address could be someone else's tunnel: never send it the saved token unasked.
  if (!token && before?.copilotUrl !== check.url) return { ok: false, message: "The address changed, so paste the token again (it's only ever sent to the address you save it with)." };
  if (token && (token.length < 16 || token.length > 200 || /\s/.test(token))) return { ok: false, message: "The token should be 16 to 200 characters, with no spaces." };

  const data = { copilotUrl: check.url, ...(token ? { copilotToken: token } : {}) };
  await db.storeSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
  await audit(session, "COPILOT_CONNECT", "StoreSettings", "default", {
    ...(before?.copilotUrl !== check.url ? { copilotUrl: { from: before?.copilotUrl ?? null, to: check.url } } : {}),
    ...(token ? { token: "changed" } : {}),
  });
  revalidatePath("/admin/assistants");
  return { ok: true, message: "Saved. Checking the connection…" };
}
