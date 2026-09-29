"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/lib/auth";
import { diffFields } from "@/lib/audit-diff";
import { CATALOG_TAG, PINCODE_TAG, SETTINGS_TAG, expireTag } from "@/lib/cache-tags";

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

  const preferredRaw = form.get("preferredPayment") ?? "ONLINE";
  if (preferredRaw !== "ONLINE" && preferredRaw !== "COD") return { ok: false, message: "Choose which way to pay checkout selects first." };
  const preferredPayment: "ONLINE" | "COD" = preferredRaw;
  const rupeeLimit = (name: string) => {
    const raw = String(form.get(name) ?? "").trim();
    const value = raw === "" ? null : Math.floor(Number(raw));
    return value === null || (Number.isFinite(value) && value >= 1 && value <= 100_000) ? { value } : null;
  };
  const floor = rupeeLimit("codMinOrderValue");
  const cap = rupeeLimit("codMaxOrderValue");
  if (!floor || !cap) return { ok: false, message: "Enter cash on delivery limits between ₹1 and ₹1,00,000, or leave them blank." };
  const codMinOrderValue = floor.value;
  const codMaxOrderValue = cap.value;
  if (codMinOrderValue !== null && codMaxOrderValue !== null && codMinOrderValue >= codMaxOrderValue) {
    return { ok: false, message: "The cash on delivery minimum must be below the maximum." };
  }
  const codAutoBlock = form.get("codAutoBlock") === "on";
  // Disabled inputs aren't sent: keep the saved thresholds while the rule is off.
  const saved = await db.storeSettings.findUnique({ where: { id: "default" }, select: { codAutoBlockRtoPercent: true, codAutoBlockMinShipped: true } });
  const percent = form.has("codAutoBlockRtoPercent") ? Math.floor(Number(form.get("codAutoBlockRtoPercent"))) : (saved?.codAutoBlockRtoPercent ?? 35);
  const minShipped = form.has("codAutoBlockMinShipped") ? Math.floor(Number(form.get("codAutoBlockMinShipped"))) : (saved?.codAutoBlockMinShipped ?? 4);
  if (!(percent >= 5 && percent <= 100)) return { ok: false, message: "The returned share must be between 5% and 100%." };
  if (!(minShipped >= 1 && minShipped <= 100)) return { ok: false, message: "The number of COD parcels must be between 1 and 100." };

  const data = {
    ordersPaused: form.get("ordersPaused") === "on",
    pauseMessage: pauseMessage || null,
    codEnabled: form.get("codEnabled") === "on",
    bundlesEnabled: form.get("bundlesEnabled") === "on",
    themeToggleVisible: form.get("themeToggleVisible") === "on",
    forcedTheme,
    // Sent only while cash on delivery is on (its fieldset is disabled otherwise): keep what was saved.
    ...(form.has("preferredPayment")
      ? { codMinOrderValue, codMaxOrderValue, preferredPayment, codAutoBlock, codAutoBlockRtoPercent: percent, codAutoBlockMinShipped: minShipped }
      : {}),
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
      codMinOrderValue: null,
      codMaxOrderValue: null,
      preferredPayment: "ONLINE",
      codAutoBlock: false,
      codAutoBlockRtoPercent: 35,
      codAutoBlockMinShipped: 4,
    }) as Record<string, unknown>,
    data,
  );
  if (Object.keys(changes).length === 0) return { ok: true, message: "No change." };

  await audit(session, "UPDATE_STORE_CONTROLS", "StoreSettings", "default", changes);
  expireTag(SETTINGS_TAG);
  expireTag(PINCODE_TAG);
  // Combo offers on product pages and cards follow the bundles switch.
  if ("bundlesEnabled" in changes) expireTag(CATALOG_TAG);
  revalidatePath("/admin/controls");
  revalidatePath("/admin");
  // The theme is applied as each storefront page loads, so shoppers see a change on their next page.
  return { ok: true, message: data.ordersPaused ? "Saved. Orders are paused on the site now." : "Saved. The site uses these settings now." };
}
