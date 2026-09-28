/**
 * Security boundaries: who can see which order (IDOR), whether ending a
 * session really ends it, whether a shopper's session opens anything in the
 * console, whether machine endpoints refuse strangers, and whether hostile
 * input comes back out as text.
 */
import { expect, test } from "@playwright/test";
import { BASE, PRODUCTS, basket, closeDemo, cookies, demo, ipFor, placeOrder, shopper } from "./fixtures";

test.afterAll(closeDemo);

async function signedInContext(browser: import("@playwright/test").Browser, token: string) {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "soulone_customer", value: token, url: BASE }]);
  return ctx;
}

test("QA-SEC-01: an order page opens only with its private link or as its owner", async ({ browser }) => {
  const owner = await shopper(500, "QA Owner");
  const stranger = await shopper(501, "QA Stranger");
  const placed = await placeOrder(await basket([{ slug: PRODUCTS.plenty.slug, quantity: 1 }]), owner, 500);
  expect(placed.status).toBe(200);
  const { orderNumber, accessToken } = placed.body as { orderNumber: string; accessToken: string };

  const anon = await browser.newContext();
  const page = await anon.newPage();
  expect((await page.goto(`${BASE}/order/${orderNumber}?t=${accessToken}`))?.status(), "with the link").toBe(200);
  expect((await page.goto(`${BASE}/order/${orderNumber}`))?.status(), "no link, not signed in").toBe(404);
  expect((await page.goto(`${BASE}/order/${orderNumber}?t=${accessToken.slice(0, -2)}xx`))?.status(), "wrong link").toBe(404);
  expect((await page.goto(`${BASE}/order/${orderNumber}/invoice?t=wrong`))?.status(), "invoice, wrong link").toBe(404);

  const ownerPage = await (await signedInContext(browser, owner.token)).newPage();
  expect((await ownerPage.goto(`${BASE}/order/${orderNumber}`))?.status(), "owner, no link").toBe(200);

  const strangerPage = await (await signedInContext(browser, stranger.token)).newPage();
  expect((await strangerPage.goto(`${BASE}/order/${orderNumber}`))?.status(), "another signed-in shopper").toBe(404);
  await strangerPage.goto(`${BASE}/account`);
  await expect(strangerPage.locator("body"), "a stranger's account never lists someone else's order").not.toContainText(orderNumber);
});

test("QA-SEC-02: signing out ends the session; signing out everywhere ends every session", async ({ browser }) => {
  const who = await shopper(510, "QA Session");
  const db = await demo();
  // A second device for the same person.
  const second = await shopper(510, "QA Session");

  const tab = await (await signedInContext(browser, who.token)).newPage();
  await tab.goto(`${BASE}/account`);
  await expect(tab.locator("h1")).toHaveText("Hello, QA");
  await tab.getByRole("button", { name: "Sign out", exact: true }).click();
  await tab.waitForURL(`${BASE}/`);

  // The old cookie, replayed in a fresh browser, is worthless.
  const replay = await (await signedInContext(browser, who.token)).newPage();
  await replay.goto(`${BASE}/account`);
  await expect(replay).toHaveURL(/\/account\/sign-in/);

  // The second device is still in, until "sign out on every device".
  const other = await (await signedInContext(browser, second.token)).newPage();
  await other.goto(`${BASE}/account`);
  await expect(other).toHaveURL(`${BASE}/account`);
  const third = await shopper(510, "QA Session");
  const thirdPage = await (await signedInContext(browser, third.token)).newPage();
  await thirdPage.goto(`${BASE}/account`);
  await thirdPage.getByRole("button", { name: "Sign out on every device" }).click();
  await thirdPage.waitForURL(`${BASE}/`);
  await other.goto(`${BASE}/account`);
  await expect(other, "every other session ended").toHaveURL(/\/account\/sign-in/);
  expect(await db.customerSession.count({ where: { customerId: who.customerId } })).toBe(0);
});

test("QA-SEC-03: a shopper's session opens nothing in the owner console", async ({ browser }) => {
  const who = await shopper(520);
  const page = await (await signedInContext(browser, who.token)).newPage();
  for (const path of ["/admin", "/admin/orders", "/admin/referrals", "/admin/boxes", "/admin/team"]) {
    await page.goto(`${BASE}${path}`);
    await expect(page, path).toHaveURL(/\/admin\/login/);
  }
  // A forged admin cookie gets past the doorway check but not the server's.
  const forged = await browser.newContext();
  await forged.addCookies([{ name: "soulone_admin", value: "not-a-real-token", url: BASE }]);
  const fp = await forged.newPage();
  await fp.goto(`${BASE}/admin/orders`);
  await expect(fp.locator("body")).not.toContainText("SO-M");
});

test("QA-SEC-04: machine endpoints refuse callers without the secret or signature", async () => {
  for (const path of ["/api/cron/expire-unpaid", "/api/cron/referrals", "/api/cron/boxes", "/api/cron/near-expiry-alert"]) {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: "Bearer guess" } });
    expect([401, 503], path).toContain(res.status);
  }
  const hook = await fetch(`${BASE}/api/webhooks/razorpay`, { method: "POST", body: JSON.stringify({ event: "payment.captured" }), headers: { "Content-Type": "application/json", "X-Razorpay-Signature": "forged" } });
  expect([401, 503], "unsigned webhook").toContain(hook.status);
});

test("QA-SEC-05: hostile input is stored and shown as text, never run", async ({ browser }) => {
  const XSS = `<img src=x onerror="window.__pwned=1">`;
  const who = await shopper(530, `Asha ${XSS}`);
  const placed = await placeOrder(await basket([{ slug: PRODUCTS.plenty.slug, quantity: 1 }]), who, 530, {
    name: `Asha ${XSS}`,
    line1: `12 Road'; DROP TABLE "Order";-- <script>window.__pwned=1</script>`,
  });
  expect(placed.status).toBe(200);
  const { orderNumber, accessToken } = placed.body as { orderNumber: string; accessToken: string };

  const page = await (await browser.newContext()).newPage();
  let dialog = false;
  page.on("dialog", async (d) => ((dialog = true), d.dismiss()));
  await page.goto(`${BASE}/order/${orderNumber}?t=${accessToken}`);
  await expect(page.locator("body")).toContainText("DROP TABLE");
  await expect(page.locator("body")).toContainText("<img src=x");
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(dialog).toBe(false);
  expect(await page.locator("img[src='x']").count(), "no injected element").toBe(0);

  // The orders table survived the "SQL" in the address.
  const db = await demo();
  expect(await db.order.count({ where: { orderNumber } })).toBe(1);
});

test("QA-SEC-06: malformed and injection-shaped input is refused cleanly, never a server error", async () => {
  const who = await shopper(540);
  const sessionId = await basket([{ slug: PRODUCTS.plenty.slug, quantity: 1 }]);
  const post = (body: unknown, n: number) =>
    fetch(`${BASE}/api/checkout/create-order`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies(sessionId, who), "CF-Connecting-IP": ipFor(n) }, body: typeof body === "string" ? body : JSON.stringify(body) });

  expect((await post("{not json", 541)).status).toBe(400);
  expect((await post({ phone: "' OR '1'='1", paymentMethod: "COD" }, 542)).status).toBe(400);
  expect((await post({ phone: who.phone, email: "x@y.z", name: "Q", line1: "Q", city: "Q", state: "Gujarat", postalCode: "38000'--", paymentMethod: "COD" }, 543)).status).toBe(400);
  expect((await post({ phone: who.phone, email: "x@y.z", name: "Q", line1: "Q", city: "Q", state: "Gujarat", postalCode: "380009", paymentMethod: "BITCOIN" }, 544)).status).toBe(400);

  const quote = await fetch(`${BASE}/api/checkout/quote`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies(sessionId, who) }, body: JSON.stringify({ couponCode: "' OR 1=1 --" }) });
  expect(quote.status).toBe(200);
  expect(((await quote.json()) as { couponRejected: boolean }).couponRejected).toBe(true);

  for (const pin of ["../../etc", "0", "1'; select", "9".repeat(50)]) {
    const r = await fetch(`${BASE}/api/pincode/${encodeURIComponent(pin)}`);
    expect(r.status, pin).toBeLessThan(500);
  }
});

test("QA-SEC-07: one connection can't place unlimited orders (flood protection)", async () => {
  const who = await shopper(550);
  const sessionId = await basket([{ slug: PRODUCTS.plenty.slug, quantity: 1 }]);
  // Invalid bodies still count against the limit, so nothing is ordered.
  const statuses: number[] = [];
  for (let i = 0; i < 22; i++) {
    const r = await fetch(`${BASE}/api/checkout/create-order`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies(sessionId, who), "CF-Connecting-IP": "10.99.200.200" }, body: "{}" });
    statuses.push(r.status);
  }
  expect(statuses.slice(-1)[0], "the 21st+ request from one address is refused").toBe(429);
});
