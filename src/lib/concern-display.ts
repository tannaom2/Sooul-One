/**
 * How a concern reads on a "Shop by concern" tile: in the shopper's words
 * ("Gut health", not "Digestive Gummies") with a matching icon. Categories are
 * named by the business in the admin, so this matches on keywords and falls
 * back to the category's own name (without a trailing "Gummies") and a neutral
 * icon for anything new. Pure, tested.
 */

export type ConcernIcon =
  | "moon"
  | "leaf"
  | "sparkle"
  | "bolt"
  | "gut"
  | "flower"
  | "scale"
  | "sun"
  | "shield"
  | "eye"
  | "bulb"
  | "bone"
  | "flame"
  | "dot";

const RULES: readonly { match: RegExp; label: string | null; icon: ConcernIcon }[] = [
  { match: /sleep/, label: "Sleep", icon: "moon" },
  { match: /stress|calm|anxi/, label: "Stress", icon: "leaf" },
  { match: /skin|nail/, label: "Skin, hair & nails", icon: "sparkle" },
  { match: /hair/, label: null, icon: "sparkle" },
  { match: /energy/, label: "Energy", icon: "bolt" },
  { match: /digest|gut/, label: "Gut health", icon: "gut" },
  { match: /pms|menopause|period|cycle/, label: "Periods & menopause", icon: "flower" },
  { match: /weight/, label: "Weight", icon: "scale" },
  { match: /daily vitamin|multivitamin/, label: "Daily nutrition", icon: "sun" },
  { match: /immun/, label: "Immunity", icon: "shield" },
  { match: /eye|vision/, label: "Eyes", icon: "eye" },
  { match: /brain|focus|memory/, label: "Focus & memory", icon: "bulb" },
  { match: /calcium|bone/, label: "Bones & growth", icon: "bone" },
  { match: /vitality|stamina/, label: "Vitality", icon: "flame" },
];

/** "Hair Fall" → "Hair fall"; "Energy Gummies" → "Energy". */
function plain(name: string): string {
  const trimmed = name.replace(/\s+gummies$/i, "").trim() || name;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export function concernDisplay(name: string): { label: string; icon: ConcernIcon } {
  const rule = RULES.find((r) => r.match.test(name.toLowerCase()));
  return { label: rule?.label ?? plain(name), icon: rule?.icon ?? "dot" };
}
