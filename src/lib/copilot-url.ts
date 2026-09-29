/**
 * Which addresses the owner console may call for the local AI copilot.
 *
 * The server makes the call (so the store's figures never pass through the
 * owner's browser to a third party), which makes this a place a typed-in
 * address could point the server at something it shouldn't reach: the
 * database, a cloud metadata address, the app itself. So only https tunnel
 * addresses from ngrok are allowed (and in development, localhost as well).
 * Any ngrok address can be anyone's, so the owner can pin their own reserved
 * domain (COPILOT_ALLOWED_HOSTS): then only that host is accepted.
 * Pure, so it's unit-tested.
 */

const TUNNEL_SUFFIXES = [".ngrok-free.app", ".ngrok-free.dev", ".ngrok.app", ".ngrok.dev", ".ngrok.io"];

export type CopilotUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

export function checkCopilotUrl(raw: string, opts: { dev: boolean; pinnedHosts?: readonly string[] } = { dev: false }): CopilotUrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "That isn't a web address. Paste the https address ngrok shows, like https://abcd-1234.ngrok-free.app" };
  }
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1";
  if (url.username || url.password) return { ok: false, reason: "Leave any user name or password out of the address; the token goes in its own box." };
  if (local) {
    if (!opts.dev) return { ok: false, reason: "localhost only works while developing. On the live site use the ngrok address." };
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Use an http or https address." };
  } else {
    if (url.protocol !== "https:") return { ok: false, reason: "Use the https address ngrok gives you." };
    const pinned = opts.pinnedHosts ?? [];
    if (pinned.length) {
      if (!pinned.includes(host)) return { ok: false, reason: `Only ${pinned.join(", ")} is allowed on this store (COPILOT_ALLOWED_HOSTS).` };
    } else if (!TUNNEL_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length)) {
      return { ok: false, reason: "Only ngrok addresses (…ngrok-free.app, …ngrok.app) are allowed, so the store can't be pointed at anything else." };
    }
    if (url.port && url.port !== "443") return { ok: false, reason: "Leave the port out; ngrok addresses don't need one." };
  }
  // Just the origin: paths are added by the console (/health, /analyze, /chat).
  return { ok: true, url: url.origin };
}

/** A stored token shown as its last four characters only. */
export function maskToken(token: string | null | undefined): string | null {
  if (!token) return null;
  return token.length <= 4 ? "••••" : `••••${token.slice(-4)}`;
}
