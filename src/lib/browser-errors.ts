import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

/**
 * Errors from shoppers' browsers (F8): what's reported, what's left out, and
 * how much. Pure, tested (tests/browser-errors.test.ts); wired up in
 * src/lib/browser-sentry.ts and forwarded by src/app/api/errors/route.ts.
 *
 * Two jobs. Privacy: the same rule as the server side (src/instrumentation.ts),
 * nothing about the person, only what broke and where. Query strings go
 * everywhere they appear, because the private order link carries its key
 * in ?t=, and searches carry what someone typed. Volume: browsers throw a
 * lot of errors that aren't ours (extensions, ad blockers, a dropped mobile
 * connection), and the free Sentry plan has a monthly allowance, so noise is
 * dropped and each error is reported once per page load.
 */

/** Messages that are never the store's bug. */
export const IGNORE_ERRORS: (string | RegExp)[] = [
  // Chrome's harmless layout warning, raised as an error.
  /ResizeObserver loop/,
  // A cross-origin script failed; the browser hides everything else about it.
  /^Script error\.?$/,
  // The connection dropped or an ad blocker stopped a request. Our own
  // fetches already show the shopper a retry.
  /^(TypeError: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)/,
  /^AbortError/,
  // Code injected by in-app browsers and translators, not ours.
  /instantSearchSDKJSBridgeClearHighlight|__gCrWeb|webkit\.messageHandlers/,
];

/** Errors whose stack starts in a browser extension. */
export const DENY_URLS: RegExp[] = [/^(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//, /^webkit-masked-url:/];

/** Most errors one page load may report; a broken loop shouldn't spend the month's allowance. */
export const MAX_PER_PAGE = 10;

/** A URL without its query string or fragment. Leaves anything unparseable alone apart from those. */
export function withoutQuery(url: string): string {
  return url.replace(/[?#].*$/, "");
}

/** Strips query strings out of URLs inside free text, such as an error message that quotes one. */
export function scrubText(text: string): string {
  return text.replace(/(https?:\/\/[^\s?#"'<>]+|\/[\w\-./]*)[?#][^\s"'<>]*/g, "$1");
}

/**
 * The event as it may leave the browser: no user, no cookies, no headers but
 * the browser's name, no query strings in its URL, message or breadcrumbs.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  if (event.request) {
    const ua = event.request.headers?.["User-Agent"] ?? event.request.headers?.["user-agent"];
    event.request = {
      url: event.request.url ? withoutQuery(event.request.url) : undefined,
      headers: ua ? { "User-Agent": ua } : undefined,
    };
  }
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
    for (const frame of ex.stacktrace?.frames ?? []) {
      if (frame.abs_path) frame.abs_path = withoutQuery(frame.abs_path);
    }
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.flatMap((b) => scrubBreadcrumb(b) ?? []);
  return event;
}

/**
 * What the page did before the error. Kept: page changes, clicks (which
 * element, never what was typed) and requests, all without query strings.
 * Dropped: console lines, which can hold anything.
 */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === "console" || crumb.category === "ui.input") return null;
  if (crumb.message) crumb.message = scrubText(crumb.message);
  if (crumb.data) {
    for (const key of ["url", "from", "to"]) {
      if (typeof crumb.data[key] === "string") crumb.data[key] = withoutQuery(crumb.data[key]);
    }
  }
  return crumb;
}

/** What makes two errors "the same" for the once-per-page rule. */
export function errorKey(event: ErrorEvent): string {
  const ex = event.exception?.values?.[0];
  return ex ? `${ex.type ?? "Error"}: ${ex.value ?? ""}` : (event.message ?? "");
}

/**
 * Lets each distinct error through once, and at most `max` in all, for the
 * life of one page load (a full reload starts afresh).
 */
export function createGate(max = MAX_PER_PAGE): (key: string) => boolean {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key) || seen.size >= max) return false;
    seen.add(key);
    return true;
  };
}

/**
 * Where an error report from the browser goes on to: Sentry's envelope
 * address for the project in our own DSN, or null if the report names any
 * other project (so the tunnel can't be used to send data elsewhere). The
 * envelope's first line is JSON carrying the DSN it was made for.
 */
export function envelopeTarget(envelope: string, ourDsn: string): string | null {
  const firstLine = envelope.slice(0, envelope.indexOf("\n") === -1 ? undefined : envelope.indexOf("\n"));
  let header: unknown;
  try {
    header = JSON.parse(firstLine);
  } catch {
    return null;
  }
  const dsn = (header as { dsn?: unknown } | null)?.dsn;
  if (typeof dsn !== "string" || !URL.canParse(dsn) || !URL.canParse(ourDsn)) return null;
  const theirs = new URL(dsn);
  const ours = new URL(ourDsn);
  if (theirs.host !== ours.host || theirs.pathname !== ours.pathname || theirs.username !== ours.username) return null;
  const path = ours.pathname.replace(/\/$/, "");
  const projectId = path.slice(path.lastIndexOf("/") + 1);
  if (!/^\d+$/.test(projectId)) return null;
  const prefix = path.slice(0, path.lastIndexOf("/"));
  return `${ours.protocol}//${ours.host}${prefix}/api/${projectId}/envelope/`;
}
