# SooulOne — commerce platform

Unified backend for **The True Store** (packaged food) and the **Woman Axis**,
**Kids Vault** and **Man Rituals** gummies brands, with reserved slots for the
two undefined beverage lines.

Built against the SooulOne build prompt. Section references throughout the code
point back to it.

---

## Status

Phases 0 and 1 of the Section 9 plan are complete, along with the domain logic
that later phases depend on. Phases 2–10 are not started.

| Phase | State |
|---|---|
| 0 — Setup | ✅ Scaffold, config, CI, `render.yaml`, `.env.example` |
| 1 — Data layer | ✅ Schema + seed. **Migration not yet run** — needs a live `DATABASE_URL` |
| — Domain logic | ✅ Shelf-life rule, FEFO, claims linter, GST money, product validation — **146 tests passing** |
| 2 — Admin auth shell | ✅ bcrypt + mandatory TOTP MFA, JWT session, edge proxy gate |
| 3 — Admin CRUD | ✅ products (type-aware form), batches, stores, orders, audit log |
| 4 — Storefront | ✅ home, True Store, gummies hub + brand pages, PDP, store locator |
| 5 — Cart & checkout | ✅ persisted cart, live re-quote, FEFO reservation in a transaction, Razorpay + COD, signature-verified webhook |
| 6 — Security hardening | 🟡 CSP and security headers set in `next.config.ts`; full OWASP pass outstanding |
| 7 — Automation | 🟡 Order confirmation + shipping emails wired; near-expiry alert composed but not scheduled |
| 8 — Testing | 🟡 146 unit tests green, lint + typecheck + build green; Playwright E2E outstanding |
| 9 — Deployment | ⬜ |
| 10 — Handover | ✅ `RUNNING.md`, `DEPLOYING.md`, `OWNERS-GUIDE.md`, this file |

**Verified, not asserted:** `npm run lint` (0 errors), `npm test` (146 passing),
`npm run typecheck` (strict), `npm run build` (24 routes). What could NOT be
verified in the authoring sandbox is anything touching a live database —
Prisma's engine CDN was unreachable there, so the app was compiled against
generated *types* rather than a running Postgres. Follow `RUNNING.md` and place
one real order before trusting it.

The build was deliberately taken depth-first through the compliance logic
rather than breadth-first across screens. Those rules are the part of this
system where being wrong is expensive and being wrong is invisible — a
storefront that renders incorrectly is obvious within a minute, whereas a
shelf-life rule off by one reading ships non-compliant orders for months.

---

## Getting started

Full walkthroughs live in **[`RUNNING.md`](RUNNING.md)** (local setup, step by
step, written for a non-developer) and **[`DEPLOYING.md`](DEPLOYING.md)**
(GitHub, then Render). The short version:

```bash
npm install
cp .env.example .env.local        # fill in DATABASE_URL at minimum
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

```bash
npm test              # Vitest
npm run typecheck     # tsc --noEmit, strict
npx prisma validate   # schema check
```

---

## Three things found while building that change the brief

### 1. `prisma@latest` currently resolves to a release candidate

At the time of writing, the `latest` dist-tag on the `prisma` CLI points to
`8.0.0-rc.15`, while `@prisma/client` stable is `7.10.0`. Following the brief's
instruction to "verify current stable versions at implementation time" and
installing `latest` would have paired a pre-release CLI with a stable client.

Both are pinned to exactly `7.10.0`. Re-check before upgrading; the mismatch
will resolve when 8.0 goes stable.

### 2. The schema in Section 6 does not compile as written

Three relations were declared on only one side, which Prisma rejects:

```
Bundle.brand                    -> Brand    (no back-relation)
QuizResponse.brand              -> Brand    (no back-relation)
QuizResponse.recommendedCategory -> Category (no back-relation)
```

The `datasource` block was also written inline with semicolons, which Prisma's
grammar has no separator for.

All fixed in `prisma/schema.prisma` and marked `[FIX]` at the point of change.
Two additions are marked `[ADDED]`: `OrderItem.batchId` was promoted from a
bare string to a real relation (recall traceability is not a place for a
dangling identifier), and `Product` gained `complianceReviewedAt` /
`complianceReviewedBy` to persist Section 7.5's sign-off.

### 3. The shelf-life rule reaches the gummies, not just the food

Section 7.2 scopes the delivery rule to `PACKAGED_FOOD` line items. That looks
under-inclusive.

The regulator's direction binds **"any food article"** delivered by an
e-commerce FBO. Health supplements and nutraceuticals are categories of *food
product* under the Food Safety and Standards Act, 2006 — which is precisely why
FSSAI licenses them rather than the drug regulator, a point the brief itself
establishes in Section 2.3. If they are food articles, the rule reaches them,
and a gummy bottle delivered two weeks from expiry is as non-compliant as a
namkeen pack.

Scoping the check to packaged food would have left **three of the four live
brands unprotected.**

The rule is therefore applied to all three regulatory types, and
`shelfLifeDays` has moved out of the schema's food-only block and become
required for supplements at the validation layer. **For compliance counsel to
confirm** — this is a reading of scope, not a settled point. It is one constant
(`SHELF_LIFE_RULE_APPLIES` in `src/lib/checkout/quote.ts`) to narrow if counsel
disagrees. The asymmetry favours the wider reading: being wrong this way
diverts some short-dated gummy stock to retail, being wrong the other way ships
non-compliant orders across the whole gummies catalogue.

### 4. The shelf-life "or" resolves — and the brief was right to flag it

Section 7.2 also asked for the `30%`-vs-`45 days` condition to be confirmed
before being encoded. It reads three ways and two are wrong. Checked against
FSSAI's own worked examples:

| Total shelf life | Required at delivery | Source |
|---|---|---|
| 10 days | **3 days** | Regulator's butter example |
| 3 months | **45 days** | Regulator's long-shelf-life example |

`min(30%, 45)` gives 27 days for the 3-month case and fails. `max(30%, 45)`
demands an impossible 45 days of a 10-day product and fails. The only reading
consistent with both: **the 30% proportion governs, with 45 days as a floor
applied only where total shelf life can accommodate it.**

That is what `src/lib/compliance/shelf-life.ts` implements, with both examples
locked in as tests. The thresholds are exported as a `ShelfLifePolicy` object
rather than inlined, because the underlying wording is genuinely ambiguous and
confirming it is a question for compliance counsel.

**One consequence worth knowing about.** The rule has a discontinuity: for a
product whose shelf life sits at or just above 45 days, the lawful shipping
window collapses toward zero. A 45-day SKU can never be shipped compliantly at
all. `assessShippability()` surfaces this at data entry and product validation
rejects such a SKU unless it is marked `retailOnly` — which is exactly what
that flag is for.

---

### 5. ESLint 10 crashes on Next's own generated file

`npm run lint` failed outright with
`TypeError: scopeManager.addGlobals is not a function`, thrown from ESLint's
core before a single rule ran.

ESLint v10 requires `ScopeManager` implementations to provide `addGlobals()`.
The obvious diagnosis is "typescript-eslint hasn't caught up" — and that was a
real, widely-reported gap — but it was already fixed in `@typescript-eslint`
8.54.0, and this project resolves 8.70.0. So that wasn't it.

Bisecting by linting every directory and file individually, all of them passed.
Only the full-project run crashed. The culprit was **`next-env.d.ts`** — Next's
own auto-generated, "do not edit" declaration file. Targeted directly, ESLint
reports it as already ignored. Reached through the recursive glob walk, the
same file instead gets parsed and brings the process down. That gap between how
glob-discovered and explicitly-named files are tested against ignore patterns
is an upstream inconsistency.

It is excluded in `eslint.config.mjs`, which is the outcome ESLint already
intends — just made to actually hold during a full run.

**What was rejected along the way, and why it matters:** the common advice for
this error is `npm install eslint@^9`. Checking ESLint's published version
support policy rather than trusting the `maintenance` dist-tag: **v9.x reached
end of life on 2026-08-06**, over a month before this was written. npm still
tags it `maintenance`, and `npm install eslint@9` even prints a "no longer
supported" warning that is easy to scroll past. Pinning there would have meant
a lint toolchain receiving no fixes of any kind, including security ones, to
dodge a one-line ignore entry.

A related trap sits next to it: `eslint-config-next@16` ships a **native flat
config array**. Bridging it through `FlatCompat` — the standard adapter, and
what most examples still show — re-wraps plugin objects that self-reference,
and `@eslint/eslintrc`'s schema validator throws `Converting circular structure
to JSON` while trying to format an error. The fix is to import it directly and
skip the legacy path entirely.

### 6. Prisma 7 rejected the schema on the first real `migrate` — mandatory driver adapters, not an optional move

This surfaced only when the app was actually run against real tooling, on a
real machine, for the first time — which is exactly the gap flagged throughout
this README. `npx prisma generate` had passed in the authoring sandbox (against
a hand-written type shim, since the engine CDN was blocked there), so the first
real signal came from `npx prisma migrate dev`:

```
error: The datasource property `url` is no longer supported in schema files.
Move connection URLs for Migrate to `prisma.config.ts` and pass either
`adapter` for a direct database connection or `accelerateUrl` for Accelerate
to the `PrismaClient` constructor.
```

The schema fix alone — move `url` into a new `prisma.config.ts` — is what the
error message says and is a five-minute change. Checking further turned up the
part the error message doesn't say: **Prisma ORM 7 made driver adapters
mandatory for every relational database**, not a preview feature to opt into.
`new PrismaClient()` with a bare connection string, which is how every version
of this project's `db.ts` had been written, would not have failed at build
time — it would have failed the first time it actually touched a database,
which in this project's flow is a customer placing an order.

Fixed in three places, all constructing `PrismaClient`: the app's singleton
(`src/lib/db.ts`), the seed script, and `scripts/create-admin.ts`. Each now
builds a `pg` connection pool, wraps it in `@prisma/adapter-pg`, and passes
that adapter in. `@prisma/adapter-pg` is released in lockstep with the rest of
Prisma's monorepo, so it's pinned at the same `7.10.0` already used elsewhere —
no separate version reconciliation needed there.

One more default worth knowing: driver adapters use `pg`'s own connection
pooling, whose defaults differ from Prisma 6's built-in driver — no connection
timeout and a 10-second idle timeout, versus 5 seconds and 300 seconds before.
`db.ts` sets these explicitly rather than inheriting whatever `pg` ships next.

## What's in `src/lib`

| Module | What it does |
|---|---|
| `compliance/shelf-life.ts` | The delivery-eligibility rule, batch evaluation, shippability assessment |
| `compliance/fefo.ts` | First-Expired-First-Out allocation, near-expiry detection |
| `compliance/claims.ts` | Structure/function vs. therapeutic claims linter, supplement disclaimer |
| `checkout/quote.ts` | Order pricing — availability, per-line GST, coupon distribution, shipping |
| `checkout/delivery.ts` | Estimated delivery date, the input the shelf-life rule is judged against |
| `auth.ts` | Admin bcrypt + TOTP MFA + JWT session, audit logging |
| `db.ts` | Prisma client singleton, built with the mandatory v7 driver adapter |
| `email.ts` | Transactional email — order confirmation, shipping, owner alerts |
| `cloudinary.ts` | Server-side product image upload |
| `validation/product.ts` | Regulatory-type-aware product schema — the admin form's forcing function |
| `money.ts` | Integer-paise arithmetic, GST split, Indian digit grouping |

All pure functions taking data as arguments rather than reading the database,
so checkout, the admin dashboard and the tests exercise identical logic.

### Two design notes

**Near-expiry ≠ near-expiry.** `findNearExpiryBatches` warns when a batch
approaches the point it can no longer lawfully *ship*, not when it approaches
its printed expiry. For a 180-day product those are 54 days apart. Alerting on
expiry would fire reliably too late to act on.

**GST is computed after the discount, not before.** A discount reduces the
taxable value of the supply, so tax follows the discounted figure. Computing it
on the pre-discount amount over-declares output tax on every promotion. The
discount is distributed across lines by largest-remainder so the parts sum to
the headline figure exactly — a customer shown "₹200 off" and charged ₹199.98
off is right to complain.

**Delivery estimates are deliberately pessimistic.** Every estimate takes the
slowest end of the transit range, because the whole compliance check hangs off
that date. Estimating optimistically and arriving late means stock that passed
at checkout is non-compliant on the doorstep. Estimating pessimistically costs
the occasional sale of borderline stock. Those two errors are not the same size.

**The claims linter is a string matcher, not a lawyer.** It is tuned to
over-flag: a false positive costs an author ten seconds, a false negative costs
a regulatory finding. A clean result is not sign-off. It accepts an
`allowedPhrases` list so a brand's own category names — "Hair Fall",
"PMS & Menopause", lawful as labels per Section 8.5 — don't trip it, because a
linter that flags your own navigation gets switched off.

---

## What ships now vs. what's still missing

**Launch-blocking, now built.** Order confirmation email (sent from the Razorpay
webhook for card orders — the only point payment is actually proven — and from
the checkout route for COD, which never reaches the webhook), shipping
notification on the transition *into* SHIPPED, product image upload, and the
four policy pages Razorpay requires before it will activate a live account.

**Still missing, and not launch-blocking.** Customer accounts, the gummies
quiz, review submission and moderation, bundles and hampers, referrals and
loyalty points, Playwright E2E tests, and a scheduler to actually deliver the
near-expiry alert (the email is written; nothing calls it on a timer yet).

**The policy pages are deliberately unfinished.** They ship with the right
sections and a prompt describing what belongs in each, plus a banner saying so.
Generating plausible policy text would have produced a refund window, a
retention period and a grievance officer that nobody at SooulOne agreed to —
and it would have read as finished to whoever was meant to check it.

## Open questions blocking later phases

From Section 14, unchanged and still needed from the business:

- **FSSAI licence number**, GSTIN, PAN, registered premises addresses
- **Gelatin or pectin/agar in the gummies** — `Product.isVeg` is deliberately
  non-nullable-with-no-default so this cannot be silently assumed
- **Nutrition facts, ingredients, supplement dosing, allergens** per real SKU —
  no products are seeded for this reason
- **All product and quiz-result copy** for the three gummies brands
- **The caffeinated-beverage line's name and formulation**, and the Healthy
  Beverages definition — both have reserved, inactive brand rows and nothing else
- **Physical superstore addresses, hours, brands stocked**
- **Trademark status** (® vs. ™) for the three gummies marks

Two more surfaced during the build:

- **One legal entity or several?** Determines how many FSSAI licences and
  GSTINs, and whether `Order` needs a seller-entity column. Cheap now,
  expensive after orders exist.
- **Does a coupon that drops the basket below the free-shipping threshold
  reinstate the shipping charge?** Currently yes — the threshold is tested
  against the discounted total, which is the common convention and stops a
  coupon buying free shipping it didn't qualify for. It does surprise customers.
  A business call, not a technical one.
- **GST on the shipping charge** is currently a flat 18%. Under composite-supply
  rules it should track the principal supply, which a mixed-rate cart makes a
  judgement call. Confirm with your accountant before the first GST return.
- **`next-auth` v5 is still in beta** (`5.0.0-beta.32`). Pinned exactly, which
  is what the ecosystem does, but pinning a beta for customer auth is a
  decision someone should make consciously rather than inherit.

---

## Things deliberately not built

- **Live per-store inventory.** Decision #3. `StoreLocation` is reference data.
  No code path claims in-store stock.
- **Products.** See above.
- **Beverage categories or copy.** Reserved brand slots only.
