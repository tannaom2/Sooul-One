# Assistants: storefront Help and the owner's AI copilot

This covers two separate helpers.

1. **The storefront Help assistant** is for shoppers: order tracking, delivery to a pincode, returns, delivery charges and ways to pay, and a hand-over to a person. It runs on rules, with no AI service and no cost.
2. **The admin Copilot** is for the owner.
   - With nothing set up, it answers from the built-in insights engine (rules).
   - Optionally, it asks an AI model running on the owner's own computer (Ollama or LM Studio) through an ngrok tunnel. There is no cloud AI bill.
   - The model's answers use the same card format as the rules, so the console looks the same either way.

Owner settings are in **Settings → Assistants**.

## Storefront Help assistant

| Piece | File |
|---|---|
| Widget: Help button, chat panel, bottom sheet on phones | `src/components/storefront-bot.tsx` (mounted in `src/app/layout.tsx`) |
| API | `POST /api/chatbot/message` (`src/app/api/chatbot/message/route.ts`) |
| Rules (intents, parsing, returns, hand-over) | `src/lib/assistant.ts`, tested in `tests/assistant.test.ts` |
| Owner settings | `src/server/assistant-settings.ts` |

- **What it knows:**
  - the delivery area;
  - delivery fee and free-delivery threshold (`DEFAULT_SHIPPING_POLICY`);
  - COD availability for a pincode (the same `codForCheckout` rules checkout uses, including pincode rules and the order-value limits);
  - delivery dates, including extra days set for a pincode;
  - payment methods on offer;
  - an order's own progress;
  - the business's contact details.
- **What it never does:** make up policy. The Refunds page is still an unfinished draft, so the return window and conditions are owner-set fields. With no window set, the assistant doesn't judge eligibility: it hands the shopper to a person. Return conditions are shown in the owner's own words.
- **Order tracking** needs the order number and the mobile or email on the order.
  - It shows only the timeline: stages, dates and the courier tracking number. No address and no items.
  - A wrong number and a wrong contact get the same answer in the same time: the timeline is read only after a match.
  - It's capped at 15 lookups per 10 minutes per connection, and 20 wrong guesses per hour per order number. Only failures count, so a stranger can't cheaply lock the real customer out.
  - The general cap is 120 messages per 10 minutes.
  - When the owner switches the assistant off, the API is off too.
- **Hand-over:** a WhatsApp link with a prefilled message including the order number (when a support WhatsApp number is set), plus the customer care email and phone from Business details.
- **Telemetry:** each question records an `ASSISTANT_INTENT` event with the intent only. Nothing the shopper typed is kept.
- **Where it shows:** hidden on checkout and in the console. On phones it sits above the buy bar on product and basket pages. The owner can switch it off.

## Admin Copilot

| Piece | File |
|---|---|
| Insight rules, shared shapes, model-answer validation | `src/lib/intel/insights-engine.ts`, tested in `tests/insights.test.ts` |
| Context building, calling the copilot, fallback | `src/server/copilot.ts` |
| Address rules (SSRF guard) | `src/lib/copilot-url.ts` |
| Dashboard insight cards (streamed) | `src/app/admin/(console)/dashboard-insights.tsx`, `src/components/insight-cards.tsx` |
| Card buttons | `src/app/admin/(console)/insight-actions.ts`, `src/app/api/admin/export/churn/route.ts` |
| Drawer | `src/app/admin/(console)/copilot-drawer.tsx` ("Ask Copilot" in the sidebar) |
| Status and chat APIs | `/api/admin/copilot/health`, `/api/admin/copilot/chat` |
| Local server | `scripts/admin_llm_copilot.py`, `scripts/requirements.txt` |

### Insight rules (no model needed)

| Insight | Rule | Button |
|---|---|---|
| RTO spike | Pincode with 3+ finished COD parcels, 2+ refused, and a refusal rate ≥ the higher of 25% and twice the store rate (critical at 40%) | **Disable COD for <pincode>**: the same pincode rule as Analytics → Pincodes |
| Payment friction | A method judged DEGRADED or DOWN by payment health | **Prioritize backup over <method>** |
| Churn | Buyers in the top fifth by lifetime value with no order for 45+ days | **Export cohort (CSV)**: owner only, behind the same fresh authenticator code as Activity, logged, with a marketing-consent column |
| Risk queue | High or very high RTO-risk orders waiting to ship | Opens RTO risk |
| Sales trend | Orders down 30%+ on the previous week, from at least 10 | Opens the funnel |
| Demand gap | 20+ pincode checks from outside the delivery area in 90 days | Opens Pincodes |

**About "Prioritize backup":** SooulOne has one payment gateway, Razorpay, so there's no second gateway to switch to. The button does the next best thing: checkout notes that the method is having trouble and selects another way to pay first (card instead of UPI). It's stored like a Razorpay downtime notice, so the same checkout code handles both. Clear it from the card once the method recovers.

Every button is re-checked on the server (owner only), asks for confirmation, and is recorded in Activity. A card from the model keeps its button only when the figures back it, by the same rules as above. So text planted in the data (for example a city typed at checkout) can't add a Disable COD or payment button that the numbers don't support.

### What the copilot is sent

It gets store totals only:
- orders and revenue for the last two weeks;
- COD share;
- up to 15 pincodes with their COD refusal counts;
- each payment method's status and rates;
- lapsed-buyer counts and value;
- segment counts;
- risk-queue counts;
- outside-area demand by region.

It never gets names, phone numbers, emails or addresses. The only customer-typed text is the city on a pincode, and only a plain place name gets through (anything else is dropped). The model is told to treat data as data, and whatever it returns is validated:
- cards must match the agreed shape;
- a Disable COD action must name a pincode in the data;
- an "open" link must be a console page;
- replies are shown as plain text.

### Safety

- **Server-side call.** The console server makes the call, not the browser, so it:
  - accepts only `https://…ngrok-free.app`, `…ngrok.app`, `…ngrok.dev` and `…ngrok.io` addresses. Anyone can get an ngrok address, so on the live store set `COPILOT_ALLOWED_HOSTS` to your reserved ngrok domain, and then only that host is accepted;
  - allows localhost only in development or on the local demo (`COPILOT_ALLOW_LOCALHOST=1`, set by `demo:start`; ignored on Render);
  - never follows redirects;
  - re-checks the address on every call.
- **Token.** Every request carries `Authorization: Bearer <COPILOT_TOKEN>`.
  - The local server checks it before reading any of the request, on every endpoint including `/health`.
  - It cuts off bodies over 200 KB as they stream in.
  - The token is masked in the settings page and never written to the activity log.
  - Changing the address requires pasting the token again, so a saved token is never sent to a new host unasked.
- **Answers are capped too:** the console reads at most 200 KB of any answer, and an answer that isn't a JSON object falls back to the rules.
- **Timeouts:**
  - status: 4 s;
  - dashboard insights: 12 s;
  - chat: 45 s.

  The dashboard streams the insights section, so the rest of the page never waits. Any failure (offline, timeout, wrong token, odd answer) falls back to the rules and says why.

## Set up the local copilot

Run these on the owner's computer.

```bash
# 1. A local model (free): install Ollama from ollama.com, then
ollama pull llama3.1:8b
#    or use LM Studio: load a model and start its local server (port 1234)

# 2. The copilot's packages (a virtual environment keeps them separate)
python -m venv .venv-copilot
.venv-copilot\Scripts\activate          # Windows; macOS/Linux: source .venv-copilot/bin/activate
pip install -r scripts/requirements.txt

# 3. Start it. It prints a token; set COPILOT_TOKEN to keep the same one across restarts
python scripts/admin_llm_copilot.py
#    LM Studio instead:   set COPILOT_BACKEND=lmstudio   (PowerShell: $env:COPILOT_BACKEND="lmstudio")
#    No model, to test:   set COPILOT_BACKEND=mock

# 4. Share it through a tunnel (install ngrok from ngrok.com and sign in once)
ngrok http 8000

# 5. In the console: Settings → Assistants → paste the https address ngrok shows and the token → Save and connect.
#    The dot turns green (Online). The Overview's insights and "Ask Copilot" now use the local model.
```

**When the laptop sleeps or the tunnel stops**, the dot goes red and everything falls back to the rules; nothing breaks. Free ngrok addresses change on every restart, so paste the new one each time. A reserved ngrok domain keeps it fixed.

To try the connection locally without ngrok, run `COPILOT_BACKEND=mock python scripts/admin_llm_copilot.py`, start the demo (`npm run demo:start`), and use `http://localhost:8000` as the address. localhost is allowed only on the demo and in development.
