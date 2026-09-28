import { describe, expect, it } from "vitest";
import {
  CONSOLE_THEME_SETTINGS,
  CONSOLE_THEME_STORAGE_KEY,
  DEFAULT_THEME_SETTINGS,
  THEME_STORAGE_KEY,
  resolveTheme,
  savedTheme,
  themeBootScript,
} from "../src/lib/theme";

describe("which theme the storefront shows", () => {
  it("follows the shopper's saved choice while the switch is shown", () => {
    expect(resolveTheme(true, "light", "dark", false)).toBe("dark");
    expect(resolveTheme(true, "dark", "light", true)).toBe("light");
  });

  it("falls back to the device setting until the shopper chooses", () => {
    expect(resolveTheme(true, "light", null, true)).toBe("dark");
    expect(resolveTheme(true, "dark", null, false)).toBe("light");
    // Anything else in storage counts as no choice.
    expect(resolveTheme(true, "light", "sepia", true)).toBe("dark");
  });

  it("forces the owner's theme while the switch is hidden, whatever the shopper saved", () => {
    expect(resolveTheme(false, "dark", "light", false)).toBe("dark");
    expect(resolveTheme(false, "light", "dark", true)).toBe("light");
    expect(resolveTheme(false, "nonsense", null, true)).toBe("light");
  });

  it("reads only valid saved values", () => {
    expect(savedTheme("dark")).toBe("dark");
    expect(savedTheme("Dark")).toBeNull();
    expect(savedTheme(undefined)).toBeNull();
  });

  it("defaults to showing the switch, in Day mode", () => {
    expect(DEFAULT_THEME_SETTINGS).toEqual({ toggleVisible: true, forcedTheme: "light" });
  });
});

describe("the script that sets the theme before the first paint", () => {
  // Runs the real script against a stand-in document, storage and media query.
  function run(settings: { toggleVisible: boolean; forcedTheme: "light" | "dark" }, stored: string | null, prefersDark: boolean, storageThrows = false) {
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    const env = {
      document: { documentElement: root },
      localStorage: {
        getItem: (key: string) => {
          if (storageThrows) throw new Error("blocked");
          return key === THEME_STORAGE_KEY ? stored : null;
        },
      },
      matchMedia: () => ({ matches: prefersDark }),
    };
    new Function("document", "localStorage", "matchMedia", themeBootScript(settings))(env.document, env.localStorage, env.matchMedia);
    return root;
  }

  it("applies the saved choice, and the device setting when there's none", () => {
    expect(run({ toggleVisible: true, forcedTheme: "light" }, "dark", false).dataset.theme).toBe("dark");
    expect(run({ toggleVisible: true, forcedTheme: "light" }, null, true).dataset.theme).toBe("dark");
    expect(run({ toggleVisible: true, forcedTheme: "light" }, null, false).style.colorScheme).toBe("light");
  });

  it("applies the forced theme while the switch is hidden", () => {
    expect(run({ toggleVisible: false, forcedTheme: "dark" }, "light", false).dataset.theme).toBe("dark");
  });

  it("reads the owner console's own saved choice, not the storefront's", () => {
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    const storage = { getItem: (key: string) => (key === CONSOLE_THEME_STORAGE_KEY ? "dark" : "light") };
    new Function("document", "localStorage", "matchMedia", themeBootScript(CONSOLE_THEME_SETTINGS, CONSOLE_THEME_STORAGE_KEY))(
      { documentElement: root },
      storage,
      () => ({ matches: false }),
    );
    expect(root.dataset.theme).toBe("dark");
  });

  it("leaves the page alone (Day) when storage is blocked", () => {
    expect(run({ toggleVisible: true, forcedTheme: "light" }, null, true, true).dataset.theme).toBeUndefined();
  });
});
