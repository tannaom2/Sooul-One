import { test, expect } from "@playwright/test";
import { E2E_PRODUCT_SLUG } from "./global-setup";

/**
 * Golden-path checkout, end to end, against a real database.
 *
 * This is the flow the whole business depends on — browse, add to basket,
 * pay (or COD), get a confirmed order. Unit tests already cover the pricing
 * and compliance math in isolation; this suite instead proves those pieces
 * are actually wired together correctly behind real HTTP requests and a real
 * browser, which is the class of bug unit tests structurally cannot catch
 * (a route forgetting to pass a field through, a session cookie not
 * surviving a redirect, and so on).
 *
 * Card payment (Razorpay) is deliberately not exercised here — it hands off
 * to Razorpay's own hosted checkout.js, which is out of this app's control
 * and not something a test should be asserting against. COD exhausts the
 * same order-creation path (quote → transaction → stock decrement →
 * confirmation email) without leaving the app.
 */

const uniquePhone = () => `9${String(Date.now()).slice(-9)}`;

/**
 * The product page swallows any database error into a plain 404 (see
 * product/[slug]/page.tsx) rather than a 5xx, which is itself worth fixing
 * separately — it would hide a real outage behind "page not found" instead of
 * something a monitor would catch. Until then, a transient connection blip to
 * a free-tier database that has been idle (exactly the situation right after
 * this suite's setup step just wrote to it) looks indistinguishable from a
 * missing product, so the very first navigation retries past that instead of
 * failing the whole run on infrastructure noise.
 */
async function gotoProductWithRetry(page: import("@playwright/test").Page, path: string, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    await page.goto(path);
    if (await page.getByRole("heading", { name: /E2E Test Product/i }).isVisible().catch(() => false)) return;
    await page.waitForTimeout(3_000);
  }
  await page.goto(path); // final attempt, let it fail with a normal assertion below
}

test("guest can browse, add to basket, and place a COD order", async ({ page }) => {
  await gotoProductWithRetry(page, `/product/${E2E_PRODUCT_SLUG}`);
  await expect(page.getByRole("heading", { name: /E2E Test Product/i })).toBeVisible();

  await page.getByRole("button", { name: "Add to basket" }).click();
  await expect(page.getByRole("link", { name: "Go to basket" })).toBeVisible();
  await page.getByRole("link", { name: "Go to basket" }).click();

  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByText(/E2E Test Product/i)).toBeVisible();

  await page.getByRole("link", { name: /checkout/i }).click();
  await expect(page).toHaveURL(/\/checkout/);

  await page.locator("#name").fill("Playwright Tester");
  await page.locator("#email").fill("e2e-tester@example.com");
  await page.locator("#phone").fill(uniquePhone());
  await page.locator("#line1").fill("221B Test Lane");
  await page.locator("#city").fill("Mumbai");
  await page.locator("#state").fill("Maharashtra");
  await page.locator("#postalCode").fill("400001");

  // Wait for the server re-quote to resolve before reading the total —
  // it's debounced client-side, so an immediate read can catch a stale quote.
  await expect(page.getByText("Working out your total…")).toHaveCount(0, { timeout: 10_000 });

  await page.getByRole("radio", { name: /cash on delivery/i }).check();

  await page.getByRole("button", { name: "Place order" }).click();

  await expect(page).toHaveURL(/\/order\//, { timeout: 15_000 });
  await expect(page.getByText("Order placed")).toBeVisible();
});

test("checkout blocks submission until required address fields are filled", async ({ page }) => {
  await gotoProductWithRetry(page, `/product/${E2E_PRODUCT_SLUG}`);
  await page.getByRole("button", { name: "Add to basket" }).click();
  await page.goto("/checkout");

  // Ready gate in checkout/page.tsx requires name/email/phone/line1/city/state/postalCode.
  await expect(page.getByRole("button", { name: /pay now|place order/i })).toBeDisabled();

  await page.locator("#name").fill("Playwright Tester");
  await expect(page.getByRole("button", { name: /pay now|place order/i })).toBeDisabled();
});
