@AGENTS.md

## Testing

The full plan and coverage map are in docs/QA.md.

- `npm test`: unit and integration tests (Vitest, `tests/**/*.test.ts`). They touch no database. Run before every change is called done.
- `npm run typecheck` and `npm run lint`: they must stay clean (lint has 8 known warnings in the admin product form).
- `npm run demo:start`, then `npm run test:qa`: the QA suite (Playwright, `tests/qa/*.spec.ts`), covering concurrency, security, UI data binding and failure modes against the **demo server and demo database only**. Global setup refuses to run unless the server on :3000 is the demo, and teardown deletes every fixture. Options: `QA_USERS=20` (racing shoppers), `QA_KEEP=1` (keep fixtures), `QA_BASE_URL`.
- `npm run test:e2e`: the checkout E2E, meant for CI's fresh database. Don't run it locally: it writes to whatever database `.env.local` points at, which is the real store.

Rules:
- Never point a test that writes at the real database (`neondb`). Write only through `demoClient` (scripts/demo/lib.ts), which refuses any database not named `*_demo`.
- New schema: diff against the demo database and apply with `npm run demo:migrate`. Pushing to main migrates Render's database (render.yaml runs `prisma migrate deploy`), so ask first.
- A new business rule gets a pure-function test. A new money path also gets a line in `tests/quote-invariants.test.ts` if it changes the total.
- UI tests assert both ways: the live value is there, and no fallback, placeholder or unbound value is (see `LEAK_PATTERN` in tests/qa/fixtures.ts).
- A failing test that reveals an application bug gets a diagnostic report ([Module], [Test ID], [Cause], [Expected vs Actual]) and approval before the application code is changed.

## Admin intelligence, security and bots

Full reference: docs/INTELLIGENCE.md. The short version for making changes:

- **Where the rules live:** every figure on Analytics → Pincodes, Payments, Customers and RTO risk comes from a pure function in `src/lib/intel/`, tested in `tests/intel.test.ts`. Pages only fetch (`src/server/intel-reports.ts`) and draw. Change a rule there, add a test, and keep the table in docs/INTELLIGENCE.md in step.
- **Storefront controls driven by the reports:** `src/server/intel.ts`.
  - `codForCheckout` holds the COD rules: pincode rule, automatic switch-off, buyer refusals, and the minimum and maximum order value. Both the quote route and create-order call it, so the page and the server never disagree.
  - `extraDeliveryDays` adds the per-pincode delivery days.
  - `recordOrderRisk` scores each order after it's placed.
  - Cached reads expire through `PINCODE_TAG` and `SETTINGS_TAG` (`src/lib/cache-tags.ts`).
- **The 10-item rule:** dense admin lists show 10 rows (`INTEL_PAGE_SIZE`, `ORDERS_PAGE_SIZE`) in a split layout. The list goes on the left and charts of exactly those rows on the right, using `Pager` and charts from `src/components/charts.tsx` (server-rendered SVG, no chart library). Chart colours are the `--chart-*` tokens; `tests/theme-contrast.test.ts` keeps them at 3:1 in Day and Night.
- **Activity (audit log):** Owner only, behind a step-up (`src/lib/step-up.ts`): a fresh authenticator code for a 10-minute pass bound to the admin, their session version and their browser. Don't weaken it, and don't add a way around it.
- **Bot guard:** `src/proxy.ts` calls `src/lib/bot-guard.ts`. A new server-to-server endpoint (a webhook, cron or health check) must be added to `EXEMPT` there, or tools calling it will get a 403. Throttling answers 429, never 403.
- **Turnstile:** `src/lib/turnstile.ts`. It's off until `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set. Checkout fails open if Cloudflare is down; the step-up fails closed. Give each new form its own `action` name and check it server-side.

Commands:
- `npm run demo:intel`: add the intelligence demo data to an existing demo database (runs once; `demo:up` includes it).
- `DEMO_TURNSTILE=1 npm run demo:start`: the demo with Cloudflare's always-pass Turnstile test keys (localhost only).
- `BOT_GUARD=monitor npm run dev`: log what the bot guard would refuse, without refusing. It's the default outside production.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` against a production build (`npm run demo:start`): 403 means the bot guard is blocking. `curl -A "Mozilla/5.0 ... Chrome/129" -H "Accept-Language: en-IN" ...` gets through.

Env for production (Render):
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`: recommended.
- `BOT_GUARD`: optional, `block` by default.
- `TRUST_TRUE_CLIENT_IP=1`: only if Cloudflare's True-Client-IP is on.
- Subscribe the Razorpay webhook to `payment.downtime.*` as well as payment and refund events.

## Assistants: storefront Help and admin Copilot

Full reference: docs/COPILOT.md.

- **Storefront Help** (`src/components/storefront-bot.tsx`, `POST /api/chatbot/message`, rules in `src/lib/assistant.ts`) runs on rules only.
  - It must never state a policy the business hasn't set: return rules come from Settings → Assistants, and with none set it hands over to a person.
  - Order lookups need the order number plus the mobile or email, show the timeline only, and are rate-limited (`assistant`, `assistantLookup`).
- **Admin Copilot:**
  - Insight cards and chat come from `src/lib/intel/insights-engine.ts` (rules) or from the owner's local model via `src/server/copilot.ts`. Both use the same `Insight` shape; model answers go through `parseCopilotReport`.
  - Keep the context store-level: no names, phones, emails or addresses.
  - Keep copilot URLs going through `checkCopilotUrl` (ngrok hosts only; localhost only in dev or the demo).
  - Card buttons are server actions in `src/app/admin/(console)/insight-actions.ts`: owner only and logged.

Local copilot, on the owner's machine:

```bash
python -m venv .venv-copilot && .venv-copilot\Scripts\activate    # macOS/Linux: source .venv-copilot/bin/activate
pip install -r scripts/requirements.txt                            # fastapi, uvicorn, httpx, pydantic
ollama pull llama3.1:8b                                            # or load a model in LM Studio (COPILOT_BACKEND=lmstudio)
python scripts/admin_llm_copilot.py                                # prints the token; COPILOT_BACKEND=mock tests without a model
ngrok http 8000                                                    # then Settings → Assistants: paste the https address + token
```

Check it by hand:

```bash
curl http://127.0.0.1:8000/health -H "Authorization: Bearer $COPILOT_TOKEN"
curl -X POST http://127.0.0.1:8000/analyze -H "Authorization: Bearer $COPILOT_TOKEN" -H "Content-Type: application/json" -d '{"context":{}}'
```

On the demo, `http://localhost:8000` is accepted as the address, because demo:start sets `COPILOT_ALLOW_LOCALHOST=1`.

## Brand family, trust and support

Full reference: docs/BRANDS.md.

- Never type a store fact into copy. Use `{freeDelivery}`, `{deliveryFee}` and `{area}` (`src/lib/site-content.ts`); they fill from the same constants checkout uses.
- Brand domains (`src/lib/brand-domains.ts`, applied in `src/proxy.ts`) are OFF, REDIRECT or STANDALONE per brand.
  - Brand and product pages set their canonical through `canonicalFor()`.
  - Keep `/admin` on the main site.
- The batch check (`/verify`) says "this batch is ours", never that a pack is genuine, and never calls a miss a fake.
- Articles for the gummies brands go through `lintSupplementCopy` plus a person's sign-off before publishing.
- Owner-written storefront content is cached under `CONTENT_TAG`. Expire it in every action that changes it.
