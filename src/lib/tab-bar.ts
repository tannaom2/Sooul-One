/**
 * Where the storefront's bottom tab bar shows (phones and upright tablets,
 * src/components/tab-bar.tsx). Not on pages that already have a bar at the
 * bottom (a product's buy bar, the box tray, the basket's checkout bar), not
 * in checkout (nothing should pull a shopper away mid-order), and not in the
 * console. Pure, tested (tests/home-screen.test.ts); the Help button uses it
 * too, to sit above the bar.
 */
const HIDDEN = ["/product", "/box", "/cart", "/checkout", "/admin", "/order"];

export function showsTabBar(path: string): boolean {
  return !HIDDEN.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
