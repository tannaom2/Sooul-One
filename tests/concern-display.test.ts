import { describe, expect, it } from "vitest";
import { concernDisplay } from "../src/lib/concern-display";

describe("concernDisplay", () => {
  it.each([
    ["Sleep Support", "Sleep", "moon"],
    ["Stress Relief", "Stress", "leaf"],
    ["Skin, Nail & Hair", "Skin, hair & nails", "sparkle"],
    ["Energy Gummies", "Energy", "bolt"],
    ["Digestive Gummies", "Gut health", "gut"],
    ["PMS & Menopause", "Periods & menopause", "flower"],
    ["Weight Management", "Weight", "scale"],
    ["Daily Vitamin", "Daily nutrition", "sun"],
    ["Multivitamin", "Daily nutrition", "sun"],
    ["Immunity", "Immunity", "shield"],
    ["Eye Care", "Eyes", "eye"],
    ["Memory & Brain Focus", "Focus & memory", "bulb"],
    ["Calcium + D3", "Bones & growth", "bone"],
    ["Men Vitality", "Vitality", "flame"],
  ])("reads %s as %s", (name, label, icon) => {
    expect(concernDisplay(name)).toEqual({ label, icon });
  });

  it("keeps a concern it doesn't know, in plain case, with a neutral icon", () => {
    expect(concernDisplay("Hair Fall")).toEqual({ label: "Hair fall", icon: "sparkle" });
    expect(concernDisplay("Joint Care Gummies")).toEqual({ label: "Joint care", icon: "dot" });
  });
});
