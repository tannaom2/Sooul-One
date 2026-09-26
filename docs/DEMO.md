# Running a demo

A fully stocked copy of the store (34 products, 90 days of orders, invoices, reviews, analytics and a team) for live presentations. It lives in its own database, `sooulone_demo`, next to the real one, and is deleted afterwards. The real database is never written to: every command checks it before and after and reports if a single row count changed.

## The three commands

| When | Command | Takes |
|---|---|---|
| About an hour before | `npm run demo:up -- --fresh` | 4–7 minutes |
| When you're ready to present | `npm run demo:start` | about 1 minute, then serves at http://localhost:3000 |
| Straight after | Ctrl+C, then `npm run demo:down` | under a minute |

Build it **the same day**. Orders are dated relative to when you build, so a morning build shows orders from this morning and a packing queue waiting for the afternoon courier.

## Signing in

`demo:up` prints a **temporary password** for the presenter account, `tannaom2+demo@gmail.com` (owner). It's shown once.

1. Go to http://localhost:3000/admin and sign in with that email and password.
2. Choose your own password, then scan the QR code with your authenticator app. The new entry is labelled with the **demo** email, so it won't be confused with your real one.
3. Optional: on Account security, make recovery codes. They only work in the demo database.

Every `demo:up` makes a new presenter account, so repeat this after each rebuild. Delete the authenticator entry after the demo.

## What's in it

- **Storefront:** four brands, 34 products with pack illustrations, full label and supplement facts, ratings and reviews, discounts, low-stock and out-of-stock states, three superstores, bundles.
- **Console:** revenue up about 40% on the previous 30 days, around 360 orders across every status (packing queue, shipped, delivered, cancelled, returned, RTO, failed payments), consecutive GST invoices, 7 reviews waiting for moderation (two that should be rejected, one of which the claims checker flags), a batch nearing its shipping cut-off, low stock, a funnel of about 15,000 sessions with abandoned carts, 5 team members and a month of activity log.

## Safe to click anything

`demo:start` switches off email, payments, image upload and error reporting for its own process only. So "Mark shipped" emails nobody, checkout can take cash-on-delivery orders without charging anyone, and nothing leaves your machine. Orders you place during the demo go into the demo database and disappear with it.

Team members other than you can't sign in: their passwords are random and were never shown to anyone.

## Afterwards

`npm run demo:down`:

- drops the demo database, so every demo row goes with it and nothing can be left orphaned
- deletes the pack illustrations and Next's cache
- confirms the demo database is gone, and that the real database's row counts match the ones taken before the demo

Then `npm run dev` brings your normal app back.

## If something goes wrong

- **"Can't reach the database" or `ENOTFOUND` (common on a phone hotspot):** `demo:up` retries and rebuilds on its own, up to three times. If it still fails, run `ipconfig /flushdns` in a terminal and try again.
- **"sooulone_demo already exists":** add `--fresh`, or run `npm run demo:down` first.
- **Port 3000 is busy:** stop `npm run dev` (or whatever else is using it) first.
- **Anything half-finished:** `npm run demo:down` is always safe, and safe to run twice.

## Good to know

- The demo data is illustrative. Nutrition panels, supplement facts, dosages, the GSTIN and the FSSAI number are made up for the demo; the GSTIN's check digit is deliberately wrong so it can't match a real business. Never copy demo product data into the real store.
- Shoppers' names, emails and phone numbers are invented combinations, never emailed. Staff emails use `sooulone.in` as a placeholder domain.
- The demo refuses to run anywhere that looks like production (an https site address, `NODE_ENV=production`, or on Render).
