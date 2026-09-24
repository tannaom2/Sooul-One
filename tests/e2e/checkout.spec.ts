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

/** Adds the E2E product from its page; the basket drawer opens straight away. */
async function addProductAndOpenBasket(page: import("@playwright/test").Page) {
  await gotoProductWithRetry(page, `/product/${E2E_PRODUCT_SLUG}`);
  await expect(page.getByRole("heading", { name: /E2E Test Product/i })).toBeVisible();
  await page.getByRole("button", { name: "Add to basket" }).first().click();
  const basket = page.getByRole("dialog", { name: /basket/i });
  await expect(basket.getByText(/E2E Test Product/i)).toBeVisible({ timeout: 15_000 });
  return basket;
}

/** Contact step, then the address step up to (not including) "Continue to payment". */
async function fillContactAndAddress(page: import("@playwright/test").Page, address: { pincode: string; city: string; state: string }) {
  await page.locator("#phone").fill(uniquePhone());
  await page.locator("#email").fill("e2e-tester@example.com");
  await page.getByRole("button", { name: "Continue to address" }).click();

  await page.locator("#postalCode").fill(address.pincode);
  await page.locator("#name").fill("Playwright Tester");
  await page.locator("#line1").fill("221B Test Lane");
  // The pincode lookup may fill city and state itself; type over it so the
  // test states exactly what the shopper entered.
  await page.locator("#city").fill(address.city);
  await page.locator("#state").fill(address.state);
}

test("guest can browse, add to basket, and place a COD order", async ({ page }) => {
  const basket = await addProductAndOpenBasket(page);
  await basket.getByRole("link", { name: /^Checkout/ }).click();
  await expect(page).toHaveURL(/\/checkout/);

  await fillContactAndAddress(page, { pincode: "380015", city: "Ahmedabad", state: "Gujarat" });
  await page.getByRole("button", { name: "Continue to payment" }).click();

  await page.getByRole("radio", { name: /cash on delivery/i }).check();
  // Wait for the server re-quote before placing the order; it's debounced
  // client-side, so an immediate click can catch a stale quote.
  await expect(page.getByText("Working out your total…")).toHaveCount(0, { timeout: 10_000 });
  await page.getByRole("button", { name: /^Place order/ }).click();

  await expect(page).toHaveURL(/\/order\//, { timeout: 15_000 });
  await expect(page.getByText("Order placed")).toBeVisible();
});

test("checkout stops an address outside Gujarat before payment", async ({ page }) => {
  await addProductAndOpenBasket(page);
  await page.goto("/checkout");

  // A Pune pincode with "Gujarat" typed in the state box is still refused.
  await fillContactAndAddress(page, { pincode: "411001", city: "Pune", state: "Gujarat" });
  await page.getByRole("button", { name: "Continue to payment" }).click();

  await expect(page.locator("#postalCode-error")).toHaveText(/only within Gujarat/);
  await expect(page.getByRole("radio", { name: /cash on delivery/i })).toHaveCount(0);
});
