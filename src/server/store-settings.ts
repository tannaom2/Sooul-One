import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { SETTINGS_TAG } from "@/lib/cache-tags";
import { reportError } from "@/lib/observability";
import { onlinePaymentsEnabled } from "@/lib/payments-config";
import { DEFAULT_CONTROLS, checkoutState, type CheckoutState, type StoreControls } from "@/lib/store-controls";
import { ordersOpen } from "@/server/launch-readiness";
import { DEFAULT_THEME_SETTINGS, type ThemeSettings } from "@/lib/theme";

/**
 * The owner's store controls. Read on every checkout and quote, so cached and
 * expired when the owner saves. A database error falls back to the defaults
 * (everything on) rather than closing the shop over a blip.
 */
export const getStoreControls = unstable_cache(
  async (): Promise<StoreControls> => {
    try {
      const row = await db.storeSettings.findUnique({ where: { id: "default" } });
      return row
        ? { ordersPaused: row.ordersPaused, pauseMessage: row.pauseMessage, codEnabled: row.codEnabled, bundlesEnabled: row.bundlesEnabled }
        : DEFAULT_CONTROLS;
    } catch (error) {
      reportError("store-settings", error);
      return DEFAULT_CONTROLS;
    }
  },
  ["store-controls"],
  { revalidate: 3600, tags: [SETTINGS_TAG] },
);

/**
 * The storefront's Day/Night settings (src/lib/theme.ts). Read by the root
 * layout on every page, so cached the same way and expired on save. A
 * database error shows the switch in Day mode rather than failing the page.
 */
export const getThemeSettings = unstable_cache(
  async (): Promise<ThemeSettings> => {
    try {
      const row = await db.storeSettings.findUnique({ where: { id: "default" }, select: { themeToggleVisible: true, forcedTheme: true } });
      return row ? { toggleVisible: row.themeToggleVisible, forcedTheme: row.forcedTheme === "DARK" ? "dark" : "light" } : DEFAULT_THEME_SETTINGS;
    } catch (error) {
      reportError("theme-settings", error);
      return DEFAULT_THEME_SETTINGS;
    }
  },
  ["theme-settings"],
  { revalidate: 3600, tags: [SETTINGS_TAG] },
);

/** What checkout can offer right now (src/lib/store-controls.ts). */
export async function getCheckoutState(): Promise<CheckoutState> {
  const [launchGateOpen, controls] = await Promise.all([ordersOpen(), getStoreControls()]);
  return checkoutState({ launchGateOpen, controls, onlinePayments: onlinePaymentsEnabled() });
}
