/**
 * The guest shopper session cookie. Shared by src/proxy.ts (edge, which can't
 * import server-only modules) and src/server/cart.ts, so the name and options
 * can't drift between where the cookie is issued and where it's read.
 */
export const SESSION_COOKIE = "soulone_cart";

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

/**
 * Units in the basket, readable by the browser so the menu badge needs no
 * database call on every page. A display hint only: the server's basket is
 * the truth, and every basket action rewrites this from it.
 */
export const BASKET_COUNT_COOKIE = "soulone_basket_n";

export const BASKET_COUNT_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};
