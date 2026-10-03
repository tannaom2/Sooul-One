import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { SETTINGS_TAG } from "@/lib/cache-tags";
import { reportError } from "@/lib/observability";
import { onlinePaymentsEnabled } from "@/lib/payments-config";
import { DEFAULT_CONTROLS, checkoutState, type CheckoutState, type StoreControls } from "@/lib/store-controls";
import { ordersOpen } from "@/server/launch-readiness";
import { DEFAULT_THEME_SETTINGS, type ThemeSettings } from "@/lib/theme";
import { withLastGood } from "@/server/last-good";
import { DEFAULT_SHIPPING_POLICY, shippingPolicyFrom, type ShippingPolicy } from "@/lib/checkout/quote";
import { storeFacts, type StoreFacts } from "@/lib/site-content";

/** Orders held while the store's own settings can't be read and none were read before. */
export const UNREADABLE_CONTROLS: StoreControls = {
  ordersPaused: true,
  pauseMessage: "We can't take orders for a moment. Please try again in a few minutes.",
  codEnabled: false,
  bundlesEnabled: false,
};

const loadStoreControls = unstable_cache(
  async (): Promise<StoreControls> => {
    // Throws on a database error, so the error is never cached (src/server/last-good.ts).
    const row = await db.storeSettings.findUnique({ where: { id: "default" } });
    return row
      ? { ordersPaused: row.ordersPaused, pauseMessage: row.pauseMessage, codEnabled: row.codEnabled, bundlesEnabled: row.bundlesEnabled }
      : DEFAULT_CONTROLS;
  },
  ["store-controls"],
  { revalidate: 3600, tags: [SETTINGS_TAG] },
);

/**
 * The owner's store controls. Read on every checkout and quote, so cached and
 * expired when the owner saves. A database error never reopens a paused
 * store (launch defect D4): the last settings read on this server are used,
 * and with none, orders are held rather than taken on guessed settings.
 */
export const getStoreControls = withLastGood("store-settings", loadStoreControls, () => UNREADABLE_CONTROLS);

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

const loadShippingPolicy = unstable_cache(
  async (): Promise<ShippingPolicy> => {
    const row = await db.storeSettings.findUnique({ where: { id: "default" }, select: { deliveryFee: true, freeDeliveryAbove: true } });
    return row ? shippingPolicyFrom(row) : DEFAULT_SHIPPING_POLICY;
  },
  ["shipping-policy"],
  { revalidate: 3600, tags: [SETTINGS_TAG] },
);

/**
 * The delivery fee and free-delivery amount the owner set (Store controls).
 * Every quote, the basket's free-delivery bar and every {token} in copy read
 * this, so they can't disagree. A database error keeps the last fees read;
 * with none, the defaults checkout always charged.
 */
export const getShippingPolicy = withLastGood("shipping-policy", loadShippingPolicy, () => DEFAULT_SHIPPING_POLICY);

/** The live values behind copy {tokens}, with the owner's fees. */
export async function getStoreFacts(): Promise<StoreFacts> {
  return storeFacts(await getShippingPolicy());
}

/** What checkout can offer right now (src/lib/store-controls.ts). */
export async function getCheckoutState(): Promise<CheckoutState> {
  const [launchGateOpen, controls] = await Promise.all([ordersOpen(), getStoreControls()]);
  return checkoutState({ launchGateOpen, controls, onlinePayments: onlinePaymentsEnabled() });
}
