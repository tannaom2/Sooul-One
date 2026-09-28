# QA test system

Three layers. Each runs with one command, and each is safe by construction.

| Layer | Runs against | Command | What it proves |
|---|---|---|---|
| Unit and integration (Vitest) | Nothing: pure functions and route handlers with the database mocked | `npm test` | Pricing, GST, kits, boxes, credit, shelf life, stock rules, lifecycles, validation, auth and the route handlers' decisions |
| QA suite (Playwright, `tests/qa`) | **The demo server and demo database only** | `npm run demo:start`, then `npm run test:qa` | Concurrency, security boundaries, what shoppers actually see, and failure modes, through real HTTP and a real browser |
| Checkout E2E (Playwright, `tests/e2e`) | A fresh database in CI | `npm run test:e2e` (CI) | A guest can browse, add, and place a COD order; the Gujarat-only rule |

## Safety rules for the QA suite

- It writes only through `demoClient` (`scripts/demo/lib.ts`), which asks Postgres for the database's name and refuses anything not called `*_demo`.
- Before the first test, global setup checks that the server on `:3000` can see a fixture that exists only in the demo database, and stops if it can't. It will never run against the real store.
- Fixtures are tagged `qa-` (products), `91199…` (phones), `@qa.example.test` (emails) and `QA…` (codes). Teardown deletes all of them. Set `QA_KEEP=1` to keep them for inspection.
- `QA_USERS=<n>` sets how many shoppers race in the concurrency tests (default 12).
- Locally the app reads `True-Client-IP` as sent, so each virtual shopper gets its own address and its own rate-limit bucket.

## Coverage

| Domain | Test IDs | What's asserted |
|---|---|---|
| Pricing invariants | `quote-invariants.test.ts` (3,000 random baskets) | Whole paise, never negative. Total = subtotal − offers − code − credit + delivery. Line taxable + tax + delivery = total. CGST+SGST vs IGST. Savings never exceed a line. Delivery threshold judged before credit. Credit never stacks with a code. An incomplete box gets no box price. Deterministic |
| Pricing rules | `quote`, `bundles`, `kits`, `boxes`, `coupons`, `pricing`, `money`, `invoice` tests | Kits per set, step-ups, whole-rupee rounding, fixed-price boxes, coupon minimums and exclusions, GST split, rounding |
| Referrals and wallet | `referrals.test.ts` | Stages; codes; who can be referred (new phone only, not yourself, once, no A→B→A loop, cap); ₹100 per order; oldest credit first; refunds restore the same credit; risk scoring; monthly budget |
| Auth | `otp.test.ts`, `permissions`, `team-rules`, `recovery-codes`, `rate-limit-rules` | Codes hashed, bound, single-use, time-limited; codes on screen only on localhost; roles; limits |
| Order state machine | `order-lifecycle`, `payment-webhook`, `create-order-route` | Allowed moves; webhook signature, idempotent capture, no downgrade of a paid order; COD needs a proven number; route decision order |
| Concurrency | QA-CONC-01…04 | N shoppers vs the last unit (one order, stock never negative). N shoppers vs a single-use code (one use, nobody charged a price they didn't see). One wallet, two checkouts (credit spent once). A double click (one order) |
| Security | QA-SEC-01…07 | Order pages need the private link or the owner's session (IDOR). Sign-out and sign-out-everywhere end sessions. A shopper's session opens nothing in the console, and a forged admin cookie shows nothing. Cron and webhook endpoints refuse strangers. XSS and SQL-shaped input stored and shown as text. Malformed input gives 4xx, never 5xx. Order flood protection |
| UI data binding | QA-UI-01…03 | Positive: the shopper's own name ("Hello, Sarah"), masked number, orders, totals, basket count. Negative: no `undefined`, `null`, `NaN`, `[object Object]`, lorem ipsum, template braces, mangled ₹ or leftover skeletons on any page; no script errors |
| Failure modes | QA-FAIL-01…02 | Connection lost at Place order: says so, orders nothing, form kept. Refresh keeps the draft and resumes at the unfinished step. Back after ordering skips checkout |

## Known gaps

- **Live payment gateway** (success, hard or soft decline, timeout, 3-D Secure drop): the demo has no Razorpay keys. Signature checks and state moves are unit-tested; the live paths need Razorpay test keys.
- **Admin order moves end to end** (Packing → Shipped → Delivered → Returned, emails, invoice numbers): these need an admin sign-in. The rules are unit-tested.
- **Multi-tab basket sync** isn't a feature: each tab re-reads the basket when it opens the drawer or navigates. Sessions don't auto-refresh; they last 90 days from sign-in.
