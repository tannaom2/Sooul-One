import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Empty, NoAccess } from "@/components/ui";
import { reportError } from "@/lib/observability";
import { onlinePaymentsEnabled } from "@/lib/payments-config";
import { DEFAULT_CONTROLS, type StoreControls } from "@/lib/store-controls";
import { DEFAULT_THEME_SETTINGS, type ThemeSettings } from "@/lib/theme";
import { ControlsForm } from "./controls-form";
import type { CheckoutCodSettings } from "@/server/intel";

export const dynamic = "force-dynamic";

export default async function StoreControlsPage() {
  const session = await requirePermission("settings:manage");
  if (!session) return <NoAccess />;

  let controls: StoreControls = DEFAULT_CONTROLS;
  let theme: ThemeSettings = DEFAULT_THEME_SETTINGS;
  let codRules: CheckoutCodSettings = { codAutoBlock: false, codAutoBlockRtoPercent: 35, codAutoBlockMinShipped: 4, codMinOrderValue: null, codMaxOrderValue: null, preferredPayment: "ONLINE" };
  try {
    const row = await db.storeSettings.findUnique({ where: { id: "default" } });
    if (row) {
      controls = { ordersPaused: row.ordersPaused, pauseMessage: row.pauseMessage, codEnabled: row.codEnabled, bundlesEnabled: row.bundlesEnabled };
      theme = { toggleVisible: row.themeToggleVisible, forcedTheme: row.forcedTheme === "DARK" ? "dark" : "light" };
      codRules = {
        codAutoBlock: row.codAutoBlock,
        codAutoBlockRtoPercent: row.codAutoBlockRtoPercent,
        codAutoBlockMinShipped: row.codAutoBlockMinShipped,
        codMinOrderValue: row.codMinOrderValue,
        codMaxOrderValue: row.codMaxOrderValue,
        preferredPayment: row.preferredPayment,
      };
    }
  } catch (error) {
    reportError("admin/controls", error);
    return <Empty title="Can't reach the database" detail="Check DATABASE_URL and run the migrations." />;
  }

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-h2 font-extrabold">Store controls</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          Switches for the live store that take effect as soon as you save, no code change needed. Every change is
          recorded in Activity.
        </p>
      </div>
      <ControlsForm controls={controls} theme={theme} codRules={codRules} onlinePayments={onlinePaymentsEnabled()} />
    </div>
  );
}
