"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { diffFields } from "@/lib/audit-diff";
import { SETTINGS_TAG, expireTag } from "@/lib/cache-tags";

export interface ControlsResult {
  ok: boolean;
  message?: string;
}

/** Owner only: these switches stop orders or change what checkout offers. */
export async function saveStoreControls(_prev: ControlsResult, form: FormData): Promise<ControlsResult> {
  const session = await requirePermission("settings:manage");
  if (!session) return { ok: false, message: "Only the owner can change the store controls." };

  const pauseMessage = String(form.get("pauseMessage") ?? "").trim();
  if (pauseMessage.length > 300) return { ok: false, message: "Keep the pause message under 300 characters." };

  const data = {
    ordersPaused: form.get("ordersPaused") === "on",
    pauseMessage: pauseMessage || null,
    codEnabled: form.get("codEnabled") === "on",
    bundlesEnabled: form.get("bundlesEnabled") === "on",
  };
  const before = await db.storeSettings.findUnique({ where: { id: "default" } });
  await db.storeSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });

  const changes = diffFields(
    (before ?? { ordersPaused: false, pauseMessage: null, codEnabled: true, bundlesEnabled: true }) as Record<string, unknown>,
    data,
  );
  if (Object.keys(changes).length === 0) return { ok: true, message: "No change." };

  await audit(session, "UPDATE_STORE_CONTROLS", "StoreSettings", "default", changes);
  expireTag(SETTINGS_TAG);
  revalidatePath("/admin/controls");
  revalidatePath("/admin");
  return { ok: true, message: data.ordersPaused ? "Saved. Orders are paused on the site now." : "Saved. The site uses these settings now." };
}
