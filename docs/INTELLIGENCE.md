# Admin intelligence, security and bot protection

This file covers what the owner console's intelligence reports show, how each number is worked out, and the controls they drive on the storefront. It also covers the Activity step-up check and the storefront bot guard.

The market research behind the choices is summarised at the end.

## Map

| Area | Where | Rules (pure, tested) | Data and wiring |
|---|---|---|---|
| Overview charts | Admin → Analytics | `src/lib/order-analytics-compute.ts` | `src/lib/order-analytics.ts` |
| Pincodes | Analytics → Pincodes | `src/lib/intel/pincodes.ts` | `src/server/intel-reports.ts` (`pincodeReport`) |
| Payment health | Analytics → Payments | `src/lib/intel/payment-health.ts` | `pincodeReport`'s sibling `paymentReport`; webhook in `src/app/api/webhooks/razorpay` |
| Customer 360, RFM, cohorts, CAC | Analytics → Customers, and one page per customer | `src/lib/intel/customers.ts` | `customerData`, `customerDetail` |
| RTO risk | Analytics → RTO risk (also in the Sell nav, for Fulfilment) | `src/lib/intel/rto-risk.ts` | `recordOrderRisk` (at order time), `riskQueue` |
| COD rules at checkout | Store controls; Pincodes (per pincode) | `codDecision` in `pincodes.ts` | `codForCheckout` in `src/server/intel.ts`; quote and create-order routes |
| 10-item rule | Every dense list | `src/lib/intel/paging.ts` | `Pager` and charts in `src/components/charts.tsx` |
| Activity step-up | Settings → Activity | `src/lib/step-up-rules.ts` | `src/lib/step-up.ts`, `activity/actions.ts` |
| Turnstile | Checkout, Activity step-up | none | `src/lib/turnstile.ts`, `src/components/turnstile.tsx` |
| Bot guard | Every storefront request | `src/lib/bot-guard.ts`, `src/lib/memory-rate-limit.ts` | `src/proxy.ts`, `src/server/crawler-verify.ts` |

Tests: `tests/intel.test.ts`, `tests/bot-guard.test.ts`, the new cases in `tests/create-order-route.test.ts` and `tests/payment-webhook.test.ts`, and the chart-contrast check in `tests/theme-contrast.test.ts`.

## Data

The migration is `20260930090000_intelligence`. It is additive only.

- **`Order`** gains three columns:
  - `postalCode`: copied from the address and indexed, so pincode reports and COD rules don't scan JSON.
  - `riskScore` and `riskReasons`: set just after the order is placed.
  - The migration backfills `postalCode` from `shippingAddress`.
- **`PaymentAttempt`**: every Razorpay capture and failure.
  - Includes retries on an order that already failed, which the order's own status can't show.
  - Records who caused a failure (`errorSource`).
  - Unique on (payment id, status), so a redelivered webhook adds nothing.
  - The migration backfills it from order timelines.
- **`PaymentDowntime`**: Razorpay's `payment.downtime.*` notices.
- **`PincodeRule`**: the owner's per-pincode rule. It can switch COD off, always allow it, add extra delivery days, and carry a note.
- **`MarketingSpend`**: spend per month, entered by the owner, for CAC.
- **`StoreSettings`** gains:
  - `codMinOrderValue` and `codMaxOrderValue`;
  - `preferredPayment`;
  - `codAutoBlock`, `codAutoBlockRtoPercent` and `codAutoBlockMinShipped`.
- **`AnalyticsEventType`** gains:
  - `PINCODE_CHECKED`, recorded by the server when a pincode is typed at checkout;
  - `PAYMENT_DISMISSED`, sent by the browser when the payment window is closed unpaid.

Reports load order history into memory and aggregate it with the pure functions. That suits thousands of orders. Past roughly 50,000, move the groupings into SQL, and the functions stay the reference.

## Definitions

"Kept" orders are PAID, PROCESSING, SHIPPED and DELIVERED. "Finished" parcels are DELIVERED, RTO and RETURNED.

| Metric | Definition |
|---|---|
| Delivered share (success rate) | delivered ÷ finished |
| COD RTO rate | COD orders ending RTO ÷ finished COD orders |
| Order to doorstep | mean of `deliveredAt − placedAt`, delivered orders |
| On time | delivered by the end of the promised day (India time) ÷ delivered orders with a promise |
| Buyer | the signed-in account, otherwise the mobile number, otherwise the email. Guest orders with an account's number fold into the account. |
| LTV | kept revenue to date; margin LTV = sale value before GST, minus landed cost (`unitCost`), when every product has a cost |
| Cadence | mean days between kept orders; next due = last kept order + cadence |
| RFM | recency bins at ≤30/60/90/180 days = 5..1; frequency 1/2/3/4–5/6+ kept orders = 1..5; monetary = quintile rank among buyers. Segments come from R and F (Champions, Loyal, Potential loyalist, New, Needs attention, At risk, About to sleep, Can't lose, Hibernating), each with a suggested action. |
| Cohort retention | share of each month's new buyers with a kept order in month +1..+5 |
| CAC | that month's marketing spend ÷ new buyers that month |
| Value ÷ cost | margin LTV to date per customer (revenue if costs are missing) ÷ CAC |

## RTO risk score

The score runs 0–100. It is additive, every reason is shown, and it contains no machine learning: the store has too few orders to train on, and whoever makes the call has to see the reasons.

| Signal | Points |
|---|---|
| Cash on delivery | +25 |
| First order (COD) | +15 |
| Number not confirmed by code (COD) | +10 |
| Earlier parcels came back | +30 each, at most +40 |
| Delivered before / 3+ delivered | −10 / −20 |
| Has paid online before (COD) | −10 |
| Another open COD order from them in 24 h | +15 |
| Pincode smoothed COD RTO ≥ 2× store (needs 2+ refusals) / ≥ 1.5× | +20 / +10 |
| Pincode ≤ 0.5× store, 5+ parcels | −5 |
| COD over ₹3,000 / over ₹1,500 | +20 / +10 |
| 6+ units, or 3+ of one product | +10 |
| Placed 11 pm – 5 am India time | +5 |
| Address under 15 characters or no number | +10 |
| Address looks made up | +15 |

The pincode rate is smoothed as `(returned + store rate × 5) ÷ (finished + 5)`, so one refusal can't read as 100%.

Bands and actions:
- 0–29 Low: ship as normal.
- 30–59 Medium: confirm by message.
- 60–79 High: call before packing.
- 80+ Very high: ask for prepayment.

Recalibrate the weights monthly once there are a few hundred finished COD parcels. Compare each band's actual RTO rate with its expected rate.

## COD rules at checkout (admin → storefront)

`codForCheckout` decides, in this order:

1. The owner's pincode rule "off" → no COD.
2. The automatic rule, when opted in, needs both:
   - at least `codAutoBlockMinShipped` finished COD parcels to the pincode;
   - an RTO share of at least `codAutoBlockRtoPercent`.

   A pincode rule of "always on" overrides it.
3. A buyer with 2 or more earlier refusals → no COD. This rule applies only to a number proven by SMS code (the signed-in shopper's). A typed number could be anyone's, and the answer mustn't reveal a stranger's history. Once SMS codes are on, cash on delivery always needs a proven number, so the rule covers every COD order.
4. The order total is outside `codMinOrderValue`..`codMaxOrderValue` → no COD.

The quote route returns `cod` so checkout disables the option with the reason. create-order enforces the same rule on the server (`COD_UNAVAILABLE`).

Pincode rules also add extra days to the delivery promise, in the quote, the pincode lookup and `promisedDeliveryDate`. Store controls also sets which payment option is selected first.

Rules are cached for up to an hour (the pincode record for 10 minutes) and expire on save (`PINCODE_TAG`, `SETTINGS_TAG`). If the rules can't be read, checkout fails open to the global COD switch.

**Why a COD minimum:** COD pays only if P(RTO) < margin ÷ (margin + loss per RTO). On a single ₹129 pack, that break-even is about 14%, which is below typical COD RTO in India. A minimum around ₹299–₹399 is the cheapest fix. It is off until the owner sets it.

## Payment health

Payment health is judged per method, from `PaymentAttempt`. Shopper-caused failures are left out; they're counted only in the "attempt rate" for checkout-experience work. A failure is shopper-caused when Razorpay reports `error_source: customer`, or, without a source, when the reason reads as a cancellation, expiry, wrong PIN or OTP, or insufficient balance.

1. **Tripwire:** the last 3 gateway attempts failed, from 2 or more orders, within 30 minutes → DOWN.
2. **Wilson 95% interval** of the recent success rate (the last 24 hours, or the last 30 attempts if that's more), with at least 10 attempts:
   - upper bound < baseline − 25 pp → DOWN;
   - upper bound < baseline − 5 pp → DEGRADED.
3. **Baseline:** the method's own previous 28 days once it has 100 or more attempts. Before that, the industry norm: UPI 90%, card 85%, net banking 80%.
4. **Razorpay downtime webhooks** show as a banner on the page. Methods with a medium or high downtime get a note at checkout. Subscribe to `payment.downtime.started/updated/resolved` in the Razorpay dashboard for this to work.

At low volume the tripwire and the downtime webhooks are the fast signals. The interval method needs about 17 attempts to spot a severe drop.

## The 10-item rule

These lists show 10 rows per page:
- Orders
- Activity
- Pincodes
- Payment failures
- Customers
- One customer's orders
- The RTO risk queue

Beside each page, on wide screens, charts cover exactly those ten rows. On phones the charts sit below the list. Charts are server-rendered HTML and SVG from `src/components/charts.tsx`. Each one:
- uses the `--chart-*` tokens, each 3:1 on surfaces in Day and Night;
- prints its values as text, so nothing depends on colour;
- needs no client JavaScript.

## Activity: owner only, with step-up

- Only an Owner sees Activity (`audit:view`).
- On top of the signed-in session, opening it needs a fresh authenticator code, plus Turnstile when configured.
- That grants a 10-minute pass: a JWT in an httpOnly, SameSite=Strict cookie scoped to `/admin/activity`. It is signed with a key derived from `JWT_SECRET` for this purpose only, and bound to the admin, their session version (reset access ends it) and a hash of the browser's user agent.
- Tries are capped (5 per 15 minutes).
- Every attempt, success, failure and "Lock now" is itself logged.

## Bot guard

`src/proxy.ts` runs `decide()` on every storefront request, before any page or API.

- **Blocked (403):**
  - announced tools (curl, python-requests, Go, Scrapy…);
  - headless browsers;
  - bulk scrapers (Bytespider, MJ12bot…);
  - an empty user agent;
  - a claimed Googlebot, Bingbot or Applebot that fails reverse-then-forward DNS against their crawler domains (`googlebot.com`/`google.com`, `search.msn.com`, `applebot.apple.com`; not `googleusercontent.com`, which is any Google Cloud VM). The address must be a real IP. No reverse record counts as a failure. A DNS timeout or error serves the request like any browser, with browser limits: never refused, never given the crawler allowance. Answers are cached for a day (5 minutes when unknown), and both the cache and concurrent lookups are capped. DuckDuckBot publishes an IP list rather than reverse DNS, so it is served like a browser.
- **Always allowed:**
  - link previews (WhatsApp, Facebook, X…);
  - verified search engines;
  - the owner console;
  - `/api/webhooks`, `/api/cron` and `/api/health`;
  - robots, the sitemap and the manifest.
- **Throttled (429 with Retry-After, never 403, so crawlers back off rather than drop pages), per IP per minute, in memory per instance.** Page loads and background fetches are counted separately: the link prefetches and in-app navigations Next.js makes (20–30 per page, labelled `Sec-Fetch-Dest: empty`) have their own allowance of 1,200 a minute, so they never use up the page allowance.
  - 240 page views;
  - 40 for a browser or link-preview user agent that sends no Accept-Language;
  - 600 for verified crawlers;
  - 90 Server Actions (basket changes).
- Checkout, quotes, pincode lookups, reviews, events and SMS codes keep their database-backed limits (`src/lib/rate-limit-rules.ts`).
- `BOT_GUARD=off|monitor|block`: block by default in production, monitor (log only) elsewhere. `BOT_GUARD_ALLOW_HEADLESS=1` is for the QA suite and the demo. Logs record the path and reason, never the IP.
- `robots.txt` disallows `/admin`, `/api`, `/cart`, `/checkout`, `/order`, `/account` and `/r/`. `X-Robots-Tag: noindex` is set on the console and accounts.

## Turnstile

Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (a free Cloudflare account; the site doesn't need to be proxied through Cloudflare).

- **Where it's used:**
  - Checkout sends the token as `X-Turnstile-Token`. create-order verifies it with the action `checkout`, before reading the basket, and fails open if Cloudflare is unreachable.
  - The Activity step-up verifies with the action `audit-step-up` and fails closed.
- Tokens are single-use and last 300 seconds. The checkout and step-up widgets reset after every attempt.
- **Demo:** `DEMO_TURNSTILE=1 npm run demo:start` uses Cloudflare's always-pass test keys, which only work on localhost.
- **Also covered:** SMS sign-in code requests (action `sms-code`; checkout's own `checkout` token is accepted for the code it sends; fails open) and review submissions (action `review`, header `X-Turnstile-Token`; fails open). Their per-number and per-IP limits still apply.

## Demo data

`npm run demo:intel` adds the intelligence demo data to an existing demo database; a fresh `demo:up` includes it. It runs once. It:
- gathers orders onto each city's busiest pincodes;
- concentrates the refused parcels in two pincodes;
- adds labelled payment failures and retries, plus a card-issuer bad day in the last 24 hours (so it goes stale on later days);
- adds pincode checks from outside Gujarat and closed payment windows;
- scores every order.

## Known limitation (needs a decision)

`clientIp` (`src/lib/rate-limit-rules.ts`) trusts `CF-Connecting-IP`. That header is only trustworthy on requests that came through Cloudflare, but Render also serves the app directly at its `*.onrender.com` address, where a client can set the header to anything and slip every per-IP limit. The fix is to trust Cloudflare headers only on requests proven to come through Cloudflare, for example with a secret header added by a Cloudflare Transform Rule, or by refusing requests whose Host isn't the real domain. It predates this work and affects the existing limits too, so it's left for the owner's go-ahead.

## Next steps (not built)

- **Record `shippedAt` and delivery attempts from the courier.** Delivery velocity is currently measured from order to door, and failed-delivery follow-up (NDR) isn't possible without them.
- **A WhatsApp or SMS confirmation step before dispatch** for Medium and higher COD orders. Keep a 5% control group so its effect can be measured.
- **A shared cache handler (Redis)** before running more than one instance. Cached rules and the page-flood counters are per instance.

## Research basis

The research ran on 29 Sept 2026. The full report, with 64 sources, was a session file and isn't kept in the repo.

- **Checkout and RTO tools:** GoKwik, Shiprocket, Razorpay Magic Checkout and Delhivery all score COD orders into bands, show reasons, and suggest an action. None publishes weights, so the table above is transparent and meant to be calibrated.
- **Indian RTO benchmarks:** national RTO was about 39% at the Nov 2025 festive peak and about 21% by Mar 2026 (Unicommerce). Health and wellness COD RTO runs 25–32% in vendor reports.
- **Payment health:** Razorpay's downtime API, its smart-routing paper (short windows, customer-caused failures excluded), and its published success-rate benchmarks.
- **KPIs:** LTV:CAC and cohorts follow Lifetimely, Triple Whale and Metorik conventions. RFM bins follow the standard 1–5 scoring. Klaviyo-style predictive CLV needs 500+ customers and 180+ days of data, so rules come first.
- **Bots:** Google's and Bing's published crawler verification (reverse then forward DNS), Cloudflare Turnstile's siteverify spec, and 429 rather than 403 for throttling.
