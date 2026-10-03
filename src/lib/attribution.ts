/**
 * Where each order came from (benchmark gap F6): the ad, campaign or site
 * that brought the shopper, kept in our own database so paid ads can be
 * measured from the first order, before any analytics account exists.
 *
 * The proxy (src/proxy.ts) reads each page visit's tags (utm_*, an ad click
 * id) or, failing those, the site it came from, and keeps two visits in a
 * first-party cookie: the first ever, and the latest that wasn't direct. A
 * direct visit never replaces a campaign (the usual "last non-direct click"
 * rule). Checkout copies both onto the order (Order.attribution).
 *
 * Only campaign tags, the landing path (no query) and the referring site's
 * name are kept: nothing about the person. Pure and edge-safe.
 */

export const ATTRIBUTION_COOKIE = "soulone_src";

/** 90 days from the latest campaign visit. */
export const ATTRIBUTION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 90,
};

export interface Touch {
  /** utm_source, the ad network a click id belongs to, the referring site, or "(direct)". */
  readonly source: string;
  /** utm_medium, or cpc / organic / social / referral / (none). */
  readonly medium: string;
  readonly campaign?: string;
  readonly term?: string;
  readonly content?: string;
  /** An ad click id (gclid, fbclid, msclkid), for uploading conversions back to the ad network later. */
  readonly clickKind?: "gclid" | "fbclid" | "msclkid";
  readonly clickId?: string;
  /** The page the visit landed on, path only. */
  readonly landing: string;
  /** ISO time of the visit. */
  readonly at: string;
}

export interface Attribution {
  readonly first: Touch;
  readonly last: Touch;
}

const DIRECT = "(direct)";

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|ecosia|baidu|search\.brave)\.[a-z.]+$/;
const SOCIAL: readonly [RegExp, string][] = [
  [/(^|\.)(instagram\.com|l\.instagram\.com)$/, "instagram"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|m\.facebook\.com|lm\.facebook\.com|l\.facebook\.com)$/, "facebook"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "x"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/(^|\.)(pinterest\.[a-z.]+|pin\.it)$/, "pinterest"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "whatsapp"],
  [/(^|\.)(reddit\.com)$/, "reddit"],
  [/(^|\.)(threads\.net)$/, "threads"],
];
const CLICK_IDS = [
  ["gclid", "google", "cpc"],
  ["fbclid", "facebook", "social"],
  ["msclkid", "bing", "cpc"],
] as const;

/** A tag value as kept: trimmed, lower-case for source and medium, bounded, printable. */
function clean(value: string | null, max = 100, lower = false): string | undefined {
  if (!value) return undefined;
  const v = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return v ? (lower ? v.toLowerCase() : v) : undefined;
}

function hostOf(referrer: string | null): string | null {
  if (!referrer || !URL.canParse(referrer)) return null;
  const url = new URL(referrer);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * The visit this page request represents, or null when it's an ordinary
 * click within our own sites (nothing to record). With no tags and no
 * outside referrer it's a direct visit.
 */
export function touchFrom(url: URL, referrer: string | null, ownHosts: readonly string[], now: Date): Touch | null {
  const q = url.searchParams;
  const landing = url.pathname.slice(0, 200) || "/";
  const at = now.toISOString();
  const click = CLICK_IDS.find(([key]) => q.get(key));
  const utmSource = clean(q.get("utm_source"), 100, true);
  const tags = {
    campaign: clean(q.get("utm_campaign")),
    term: clean(q.get("utm_term")),
    content: clean(q.get("utm_content")),
    ...(click ? { clickKind: click[0], clickId: clean(q.get(click[0]), 200) } : {}),
  };
  const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

  if (utmSource) return strip({ source: utmSource, medium: clean(q.get("utm_medium"), 100, true) ?? "(not set)", ...tags, landing, at });
  if (click) return strip({ source: click[1], medium: click[2], ...tags, landing, at });

  const host = hostOf(referrer);
  const own = new Set(ownHosts.map((h) => h.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "")));
  if (host && !own.has(host)) {
    if (SEARCH.test(host)) return { source: host.split(".").find((p) => p !== "m" && p !== "search") ?? host, medium: "organic", landing, at };
    const social = SOCIAL.find(([re]) => re.test(host));
    return { source: social ? social[1] : host.slice(0, 100), medium: social ? "social" : "referral", landing, at };
  }
  if (host) return null; // from our own pages
  return { source: DIRECT, medium: "(none)", landing, at };
}

export const isDirect = (t: Touch) => t.source === DIRECT;

/** Mediums that mean a paid placement (the names ad tools and UTM builders use). */
export const PAID_MEDIA: ReadonlySet<string> = new Set(["cpc", "ppc", "paid", "paidsearch", "paid_search", "paidsocial", "paid_social", "paid-social", "cpm", "display", "cpv", "video_ads", "shopping"]);

/**
 * The record after this visit, or null when nothing changes (so the cookie
 * isn't rewritten on every page). The first visit is kept as it was; the
 * latest is replaced by any visit that isn't direct.
 */
export function mergeTouch(current: Attribution | null, touch: Touch | null): Attribution | null {
  if (!touch) return null;
  if (!current) return { first: touch, last: touch };
  if (isDirect(touch)) return null;
  return { first: current.first, last: touch };
}

/* --------------------------------------------------------------- cookie */

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeAttribution(a: Attribution): string {
  return toBase64Url(JSON.stringify(a));
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

function readTouch(v: unknown): Touch | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const source = str(o.source, 100);
  const medium = str(o.medium, 100);
  const landing = str(o.landing, 200);
  const at = str(o.at, 40);
  if (!source || !medium || !landing || !at || Number.isNaN(Date.parse(at))) return null;
  const clickKind = o.clickKind === "gclid" || o.clickKind === "fbclid" || o.clickKind === "msclkid" ? o.clickKind : undefined;
  const optional = { campaign: str(o.campaign, 100), term: str(o.term, 100), content: str(o.content, 100), clickKind, clickId: clickKind ? str(o.clickId, 200) : undefined };
  return { source, medium, landing, at, ...Object.fromEntries(Object.entries(optional).filter(([, x]) => x !== undefined)) };
}

/**
 * The cookie's record, or null if it's missing or not one we wrote. The
 * cookie is the shopper's to edit, so every field is checked and bounded:
 * it's reporting data, never trusted for anything else.
 */
export function decodeAttribution(value: string | undefined | null): Attribution | null {
  if (!value || value.length > 3000) return null;
  try {
    return readAttribution(JSON.parse(fromBase64Url(value)));
  } catch {
    return null;
  }
}

/** A stored record (the cookie's, or Order.attribution), checked field by field. */
export function readAttribution(value: unknown): Attribution | null {
  if (!value || typeof value !== "object") return null;
  const { first, last } = value as { first?: unknown; last?: unknown };
  const f = readTouch(first);
  const l = readTouch(last);
  return f && l ? { first: f, last: l } : null;
}

/** The record from a request's Cookie header (route handlers get a plain Request). */
export function attributionFromCookieHeader(header: string | null): Attribution | null {
  const pair = header?.split(/;\s*/).find((p) => p.startsWith(`${ATTRIBUTION_COOKIE}=`));
  return pair ? decodeAttribution(decodeURIComponent(pair.slice(ATTRIBUTION_COOKIE.length + 1))) : null;
}

/** "google / cpc · diwali-sale", for the console. */
export function describeTouch(t: Touch): string {
  if (isDirect(t)) return "Direct (typed, bookmarked or an untagged app link)";
  return [`${t.source} / ${t.medium}`, t.campaign].filter(Boolean).join(" · ");
}
