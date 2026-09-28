/**
 * Day/Night mode for the storefront, set by the owner in Store controls.
 *
 *   - Switch shown (the default): the shopper's own choice, kept in this
 *     browser (localStorage); until they choose, their device's setting
 *     (prefers-color-scheme).
 *   - Switch hidden: every shopper sees the owner's chosen theme.
 *
 * The owner console has its own switch (CONSOLE_THEME_STORAGE_KEY), which
 * the storefront setting never forces. The theme is applied before the first
 * paint so a page never flashes the wrong colours: the server sets it
 * outright when it's forced, and otherwise a small inline script
 * (themeBootScript) reads the saved choice before anything is drawn.
 * Colours are the design tokens in globals.css, redefined for Night.
 */

export type ThemeName = "light" | "dark";

export interface ThemeSettings {
  readonly toggleVisible: boolean;
  readonly forcedTheme: ThemeName;
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = { toggleVisible: true, forcedTheme: "light" };

/** The localStorage key holding the shopper's choice. */
export const THEME_STORAGE_KEY = "soulone-theme";

/**
 * The owner console's own choice, kept apart from the storefront's: the
 * console always has its switch (the owner's Store controls setting governs
 * shoppers, not the team), and follows the device until someone chooses.
 */
export const CONSOLE_THEME_STORAGE_KEY = "soulone-console-theme";
export const CONSOLE_THEME_SETTINGS: ThemeSettings = { toggleVisible: true, forcedTheme: "light" };

export const THEME_LABEL: Record<ThemeName, string> = { light: "Day mode", dark: "Night mode" };

/**
 * The theme a storefront page shows. Self-contained on purpose (no imports,
 * no outside names): themeBootScript inlines this very function's source,
 * so the script and the tested rule can't drift apart.
 */
export function resolveTheme(toggleVisible: boolean, forcedTheme: string, saved: string | null, systemPrefersDark: boolean): ThemeName {
  if (!toggleVisible) return forcedTheme === "dark" ? "dark" : "light";
  if (saved === "light" || saved === "dark") return saved;
  return systemPrefersDark ? "dark" : "light";
}

/** The storage value, or null when there isn't a valid one. */
export function savedTheme(value: string | null | undefined): ThemeName | null {
  return value === "light" || value === "dark" ? value : null;
}

/**
 * The inline script that sets <html data-theme> before the first paint when
 * shoppers may choose. Anything failing (storage blocked, say) leaves the
 * page in Day mode, which the stylesheet shows by default.
 */
export function themeBootScript(settings: ThemeSettings, storageKey: string = THEME_STORAGE_KEY): string {
  const args = [
    JSON.stringify(settings.toggleVisible),
    JSON.stringify(settings.forcedTheme),
    `localStorage.getItem(${JSON.stringify(storageKey)})`,
    `matchMedia("(prefers-color-scheme: dark)").matches`,
  ].join(",");
  return `(function(){try{var t=(${resolveTheme.toString()})(${args});var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t}catch(e){}})();`;
}
