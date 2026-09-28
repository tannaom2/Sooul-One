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

## Shopper accounts and cash on delivery

No text messages are sent from the demo. Wherever a shopper would get an SMS code, the page shows it in a box labelled **Demo** instead.

- **Sign in:** use the person icon in the header, or **Your account** in the phone menu. Enter any 10-digit mobile number and type the code shown. The first code for a number creates the account. Guest orders placed with that number in the last 12 months appear straight away. To show that, pick a phone number from an order in the console.
- **Cash on delivery:** a guest who chooses it gets the code step before the order is placed. Confirming the code also signs them in, so their next checkout fills itself in. A signed-in shopper isn't asked again for their own number. Online payment never asks for a code.
- **In the console:** the order's Customer panel shows **Verified by code** or **Not verified**, and whether the shopper has an account.

On the live site, codes go by SMS once the MSG91 keys are set (see the Launch checklist). Until then, sign-in is hidden and cash on delivery works without a code.

## Make your own box and referrals

A demo database built before these existed needs `npm run demo:growth` once; `demo:up -- --fresh` includes them.

- **Make your box** in the header offers two boxes. A box is one type, never mixed:
  - **Gummies Box** (Box of Gummies, any 3 for ₹999): filter with the Gummies page's own tabs (Woman Axis, Kids Vault, Man Rituals).
  - **True Store Box** (The True Store, any 4 for ₹499): filter with the True Store category chips.
  - Products are the standard product cards with an **Add to box** button. The tray shows what the picks are worth and what the box saves. A finished box goes in the basket as one item, and **Edit box** reopens it with its picks.
- **Last-Chance Box** (gummies, any 3 for ₹899) is off. It takes only stock near its shipping cut-off or slow to sell.
- **Admin → Boxes:** create a box by choosing its type from the dropdown and a price range. Untick products to keep them out, check the margin, and put it live. Clearance rules sit under **Advanced**.
- The old mixed Family Box is switched off. Baskets that still hold it are told it isn't available any more.
- **Referrals:**
  - Mansi's link is http://localhost:3000/r/MANSI7K2. A friend opening it sees ₹100 off a first order of ₹799 or more. After they sign in with their number, the discount comes off at checkout.
  - Mansi's **Invite friends** section is on her account page. It shows her link, WhatsApp share, rewards out of 5, credit, and each friend's stage.
  - To show a reward: in Admin, mark a friend's first order delivered. The referral then waits out the return window. **Admin → Referrals → Pay reward now** credits Mansi ₹100, and her next order of ₹799 or more takes ₹100 off.
  - The review queue in **Admin → Referrals** holds one flagged sample.

## Afterwards

`npm run demo:down`:

- drops the demo database, so every demo row goes with it and nothing can be left orphaned
- deletes the pack illustrations and Next's cache
- confirms the demo database is gone, and that the real database's row counts match the ones taken before the demo

Then `npm run dev` brings your normal app back.

## If something goes wrong

- **"Can't reach the database" or `ENOTFOUND` (common on a phone hotspot):** `demo:up` retries and rebuilds on its own, up to three times. If it still fails, run `ipconfig /flushdns` in a terminal and try again.
- **"sooulone_demo already exists":** add `--fresh`, or run `npm run demo:down` first.
- **The code gained a migration after demo:up** (the app errors about a missing column): `npm run demo:migrate` applies it to the demo database and keeps its data. It never touches the real database.
- **Port 3000 is busy:** stop `npm run dev` (or whatever else is using it) first.
- **Anything half-finished:** `npm run demo:down` is always safe, and safe to run twice.

## Good to know

- The demo data is illustrative. Nutrition panels, supplement facts, dosages, the GSTIN and the FSSAI number are made up for the demo; the GSTIN's check digit is deliberately wrong so it can't match a real business. Never copy demo product data into the real store.
- Shoppers' names, emails and phone numbers are invented combinations, never emailed. Staff emails use `sooulone.in` as a placeholder domain.
- The demo refuses to run anywhere that looks like production (an https site address, `NODE_ENV=production`, or on Render).
