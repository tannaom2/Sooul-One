"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { diffFields } from "@/lib/audit-diff";
import { CATALOG_TAG, SETTINGS_TAG, expireTag } from "@/lib/cache-tags";

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

  const forcedTheme = form.get("forcedTheme");
  if (forcedTheme !== "LIGHT" && forcedTheme !== "DARK") return { ok: false, message: "Choose Day mode or Night mode for the storefront." };

  const data = {
    ordersPaused: form.get("ordersPaused") === "on",
    pauseMessage: pauseMessage || null,
    codEnabled: form.get("codEnabled") === "on",
    bundlesEnabled: form.get("bundlesEnabled") === "on",
    themeToggleVisible: form.get("themeToggleVisible") === "on",
    forcedTheme,
  } as const;
  const before = await db.storeSettings.findUnique({ where: { id: "default" } });
  await db.storeSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });

  const changes = diffFields(
    (before ?? {
      ordersPaused: false,
      pauseMessage: null,
      codEnabled: true,
      bundlesEnabled: true,
      themeToggleVisible: true,
      forcedTheme: "LIGHT",
    }) as Record<string, unknown>,
    data,
  );
  if (Object.keys(changes).length === 0) return { ok: true, message: "No change." };

  await audit(session, "UPDATE_STORE_CONTROLS", "StoreSettings", "default", changes);
  expireTag(SETTINGS_TAG);
  // Combo offers on product pages and cards follow the bundles switch.
  if ("bundlesEnabled" in changes) expireTag(CATALOG_TAG);
  revalidatePath("/admin/controls");
  revalidatePath("/admin");
  // The theme is applied as each storefront page loads, so shoppers see a change on their next page.
  return { ok: true, message: data.ordersPaused ? "Saved. Orders are paused on the site now." : "Saved. The site uses these settings now." };
}
