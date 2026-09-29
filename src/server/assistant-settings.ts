import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { SETTINGS_TAG } from "@/lib/cache-tags";
import { reportError } from "@/lib/observability";

/** The storefront assistant's settings (Settings → Assistants). Cached; expired on save. */
export interface AssistantSettings {
  readonly enabled: boolean;
  readonly returnWindowDays: number | null;
  readonly returnConditions: string | null;
  readonly supportWhatsapp: string | null;
}

const DEFAULTS: AssistantSettings = { enabled: true, returnWindowDays: null, returnConditions: null, supportWhatsapp: null };

export const getAssistantSettings = unstable_cache(
  async (): Promise<AssistantSettings> => {
    try {
      const row = await db.storeSettings.findUnique({
        where: { id: "default" },
        select: { assistantEnabled: true, returnWindowDays: true, returnConditions: true, supportWhatsapp: true },
      });
      return row
        ? { enabled: row.assistantEnabled, returnWindowDays: row.returnWindowDays, returnConditions: row.returnConditions, supportWhatsapp: row.supportWhatsapp }
        : DEFAULTS;
    } catch (error) {
      reportError("assistant-settings", error);
      return DEFAULTS;
    }
  },
  ["assistant-settings"],
  { revalidate: 3600, tags: [SETTINGS_TAG] },
);
