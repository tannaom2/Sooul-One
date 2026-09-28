/**
 * Dynamic data binding: every page is checked two ways.
 *   Positive: the live values are on screen (the shopper's own name, their
 *   masked number, the right count and totals).
 *   Negative: nothing unbound or placeholder is: no "undefined", "null",
 *   "NaN", "[object Object]", lorem ipsum, template braces or mangled ₹ signs,
 *   and no loading skeleton left behind once the page has settled.
 */
import { expect, test, type Page } from "@playwright/test";
import { BASE, LEAK_PATTERN, PRODUCTS, basket, closeDemo, demo, placeOrder, shopper } from "./fixtures";

test.afterAll(closeDemo);

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
}

async function expectNoLeaks(page: Page, where: string) {
  const text = await page.locator("body").innerText();
  const leak = text.match(LEAK_PATTERN);
  expect(leak?.[0] ?? null, `${where}: leaked "${leak?.[0]}" near "${leak ? text.slice(Math.max(0, leak.index! - 40), leak.index! + 40) : ""}"`).toBeNull();
  // Money is always a whole or two-decimal rupee amount, never "₹NaN" or "₹-".
  // Split at each ₹: a sale price sits right next to the struck list price.
  for (const m of text.match(/₹[^\s₹]*/g) ?? []) expect(m, `${where}: odd price ${m}`).toMatch(/^₹[\d,]+(\.\d{2})?(\/-)?[.,)·:;]*$/);
}

const PUBLIC_PAGES = [
  "/",
  "/true-store",
  "/true-store?category=healthy-sweets",
  "/gummies",
  "/gummies/woman-axis",
  "/gummies/kids-vault",
  "/gummies/man-rituals",
  "/product/date-almond-laddoo",
  "/product/kids-daily-multivitamin",
  "/product/biotin-glow-gummies",
  "/box/gummies-box",
  "/box/gummies-box?brand=kids-vault",
  "/box/true-store-box",
  "/stores",
  "/policies/privacy",
  "/invite?code=MANSI7K2",
  "/account/sign-in",
  "/product/no-such-product",
];

test("QA-UI-01: every public page renders live data and no unbound values", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const path of PUBLIC_PAGES) {
    await page.goto(`${BASE}${path}`);
    await settle(page);
    await expectNoLeaks(page, path);
    await expect(page.locator("h1").first(), `${path} has a heading`).not.toBeEmpty();
  }
  expect(errors, "no script errors").toEqual([]);
});

test("QA-UI-02: signed in, the account shows this shopper's name, number and orders, not fallbacks", async ({ browser }) => {
  const who = await shopper(600, "Sarah Khan");
  const placed = await placeOrder(await basket([{ slug: PRODUCTS.plenty.slug, quantity: 1 }]), who, 600);
  expect(placed.status).toBe(200);

  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "soulone_customer", value: who.token, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/account`);
  await settle(page);
  await expect(page.locator("h1")).toHaveText("Hello, Sarah");
  await expect(page.locator("h1"), "never the nameless fallback").not.toHaveText("Hello");
  await expect(page.locator("body")).toContainText(`${who.phone.slice(0, 5)} ${who.phone.slice(5)}`);
  await expect(page.locator("body")).toContainText(String(placed.body.orderNumber));
  await expect(page.locator("body")).not.toContainText("No orders yet");
  await expectNoLeaks(page, "/account");

  // Checkout: pre-filled from the last order, and says who's signed in.
  await page.goto(`${BASE}/checkout`);
  await settle(page);
  // (Empty basket for this browser, so checkout shows the empty state; the
  //  signed-in line is covered on a basket below.)
  const sessionId = await basket([{ slug: PRODUCTS.plenty.slug, quantity: 2 }]);
  await ctx.addCookies([{ name: "soulone_cart", value: sessionId, url: BASE }]);
  await page.goto(`${BASE}/checkout`);
  await settle(page);
  await expect(page.locator("body")).toContainText(`Signed in with ${who.phone.slice(0, 2)}•••••${who.phone.slice(7)}`);
  await expect(page.locator("body")).not.toContainText("No account needed");
  await expect(page.getByRole("status").filter({ hasText: "Working out your total" }), "no skeleton once the total is in").toHaveCount(0);
  await expect(page.locator("aside")).toContainText("₹900/-");
  await expectNoLeaks(page, "/checkout");
});

test("QA-UI-03: the basket badge, drawer and page agree on count and total", async ({ browser }) => {
  const ctx = await browser.newContext();
  const sessionId = await basket([{ slug: PRODUCTS.plenty.slug, quantity: 3 }]);
  await ctx.addCookies([{ name: "soulone_cart", value: sessionId, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/cart`);
  await settle(page);
  await expect(page.locator("aside")).toContainText("₹1,350/-");
  await page.getByRole("button", { name: /^Basket/ }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText("3 items");
  await expect(drawer).toContainText("Checkout · ₹1,350/-");
  await expectNoLeaks(page, "drawer");
});

test("QA-FAIL-01: losing the connection mid-checkout says so and places nothing", async ({ browser }) => {
  const who = await shopper(610, "QA Offline");
  const ctx = await browser.newContext();
  const sessionId = await basket([{ slug: PRODUCTS.plenty.slug, quantity: 1 }]);
  await ctx.addCookies([
    { name: "soulone_cart", value: sessionId, url: BASE },
    { name: "soulone_customer", value: who.token, url: BASE },
  ]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/checkout`);
  await settle(page);
  // Signed in with a previous order? No: fill the form.
  for (const [id, v] of [["phone", who.phone], ["email", `${who.phone}@qa.example.test`]]) await page.fill(`#${id}`, v);
  await page.getByRole("button", { name: "Continue to address" }).click();
  await page.fill("#postalCode", "380009");
  await page.waitForTimeout(2500);
  await page.fill("#name", "QA Offline");
  await page.fill("#line1", "1 Test Road");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /Place order ·/ }).waitFor({ timeout: 60000 });

  await ctx.setOffline(true);
  await page.getByRole("button", { name: /Place order ·/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "No connection" })).toBeVisible({ timeout: 15000 });
  await ctx.setOffline(false);

  // The form is intact for a retry, and nothing was ordered.
  await expect(page.locator("#couponCode")).toBeVisible();
  const db = await demo();
  expect(await db.order.count({ where: { customerId: who.customerId } })).toBe(0);
});

test("QA-FAIL-02: a refresh keeps the checkout draft; Back after ordering doesn't return to checkout", async ({ browser }) => {
  const who = await shopper(620, "QA Refresh");
  const ctx = await browser.newContext();
  const sessionId = await basket([{ slug: PRODUCTS.plenty.slug, quantity: 1 }]);
  await ctx.addCookies([
    { name: "soulone_cart", value: sessionId, url: BASE },
    { name: "soulone_customer", value: who.token, url: BASE },
  ]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/cart`);
  await page.goto(`${BASE}/checkout`);
  await settle(page);
  await page.fill("#phone", who.phone);
  await page.fill("#email", `${who.phone}@qa.example.test`);
  await page.reload();
  await settle(page);
  // Checkout resumes at the first unfinished step: contact is done, with the number kept.
  await expect(page.locator("li[aria-current=step] h2")).toContainText("Delivery address");
  await expect(page.locator("body")).toContainText(who.phone);

  await page.fill("#postalCode", "380009");
  await page.waitForTimeout(2500);
  await page.fill("#name", "QA Refresh");
  await page.fill("#line1", "1 Test Road");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /Place order ·/ }).click({ timeout: 60000 });
  await page.waitForURL(/\/order\//, { timeout: 60000 });
  await page.goBack();
  await expect(page, "Back skips the finished checkout").not.toHaveURL(/\/checkout/);
});
