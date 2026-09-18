# Running SooulOne locally

Start to finish, from an unzipped folder to clicking through a purchase. About
20 minutes, most of it waiting for a free database to provision.

Nothing here costs money.

---

## Before you start

You need **Node.js 22 or newer**. Check:

```bash
node --version
```

If that prints anything below `v22`, install the current LTS from
[nodejs.org](https://nodejs.org) first. Nothing below will work without it.

---

## 1. Install the dependencies

```bash
cd soulone-platform
npm install
```

Takes a minute or two. It pulls Next.js, Prisma, React and the rest.

---

## 2. Get a database

The app needs PostgreSQL. Two options.

### Option A — a free hosted database (recommended, no install)

1. Sign up at [neon.com](https://neon.com) or [supabase.com](https://supabase.com). Both have a
   permanent free tier.
2. Create a project. Choose a region near India if offered.
3. Copy the **connection string**. It looks like
   `postgresql://user:password@host/dbname?sslmode=require`.

Neon's free tier is the one the hosting notes recommend: it doesn't expire,
unlike Render's free Postgres which is deleted after 30 days.

### Option B — PostgreSQL on your own machine

If you already have Postgres running:

```bash
createdb soulone
```

Your connection string is then `postgresql://localhost:5432/soulone`.

---

## 3. Create your environment file

```bash
cp .env.example .env.local
```

Open `.env.local` in any text editor. You must fill in two values to get
started; the rest can wait.

**`DATABASE_URL`** — paste the connection string from step 2.

**`JWT_SECRET`** — this signs your admin login session. Generate a real one:

```bash
openssl rand -base64 32
```

Paste the output between the quotes. Don't invent one by typing on the keyboard;
the app refuses to start with anything under 32 characters, deliberately.

Everything else (Razorpay, Cloudinary, Resend) can stay empty for now. The app
runs without them — you just can't take card payments until Razorpay is filled
in.

---

## 4. Create the database tables

```bash
npx prisma migrate dev --name init
```

This reads `prisma/schema.prisma` and builds all 21 tables. It also generates
the typed database client the app imports.

If it errors, the connection string is almost always the cause. Check it's
pasted in full, including `?sslmode=require` if your provider requires it.

---

## 5. Load your brands and categories

```bash
npm run db:seed
```

You should see:

```
  The True Store
      - Healthy Namkeen
      - Healthy Sweets
      - Healthy Munchies
      - Gifting & Hampers
  Woman Axis
      - Daily Vitamin
      - Sleep Support
      ...
```

Six brands and twenty categories. **No products** — those carry nutrition and
dosage figures that have legal weight, so they have to be entered from your own
formulation records rather than invented by a seed script.

The True Store categories are a proposal. Change them in `prisma/seed.ts` and
re-run if you'd rather use your own.

---

## 6. Create your owner account

```bash
npm run admin:create
```

It asks for an email, a name and a password (minimum 12 characters), then prints
a setup key:

```
  Setup key: JBSWY3DPEHPK3PXP...
```

**Add that key to an authenticator app now** — Google Authenticator, Authy,
1Password, whichever you use. Open the app, choose "add account", then "enter a
setup key", and paste it.

You will need a code from that app every time you sign in. There is no way in
without it, which is the point: this account can change every price on the site.

---

## 7. Start the app

```bash
npm run dev
```

Open **http://localhost:3000**.

You should see the homepage, with an empty-state message where products will go.

---

## 8. Add your first product

1. Go to **http://localhost:3000/admin**
2. Sign in with your email and password
3. Enter the 6-digit code from your authenticator app
4. Click **Products**, then **Add a product**

Notice the form changes shape when you switch the product type at the top.
Choose "Packaged food" and it asks for a nutrition table. Choose "Health
supplement" and the nutrition table disappears and supplement facts, dosage and
a claims-review tick appear instead.

Try typing "cures hair fall" into a supplement description. It flags it before
you save, and suggests wording that's allowed.

**Fill in the shelf life.** It's required, and it decides when stock stops being
sellable. A number like `180` for a namkeen, `730` for gummies.

---

## 9. Receive some stock

A product with no batches can't be sold, because the site can't tell how fresh
the stock is.

Go to **Stock batches**, pick your product, and enter:

- a batch number (anything — `B-001`)
- a quantity
- the manufacture date
- the best-before date

Make the best-before date comfortably far out — at least 30% of the shelf life
away, or the app will correctly refuse to sell it. That's the rule working, not
a bug.

---

## 10. Buy something

1. Go back to the storefront and find your product
2. Add it to the basket
3. Go to **Checkout**
4. Fill in the address form
5. Choose **Cash on delivery** — this works with no payment setup at all
6. Place the order

You should land on an order confirmation page. Check **Admin → Orders** and it's
there, with the batch it drew from recorded against it.

**To test the compliance rule:** add a second batch with a best-before date only
a couple of weeks out. Put that product in the basket. The cart will refuse to
check out and tell you why.

---

## Turning on order emails (optional)

Without this, orders still work — the app logs what it *would* have sent
instead of failing.

1. Sign up at [resend.com](https://resend.com) (free tier is generous)
2. Verify your sending domain
3. Put the API key in `.env.local` as `RESEND_API_KEY`
4. Set `EMAIL_FROM` to an address on your verified domain
5. Optionally set `OWNER_ALERT_EMAIL` for near-expiry stock warnings

Confirmation emails for card orders are sent from the Razorpay webhook, not at
checkout — so in local development you'll only see them once webhooks are
reaching you. Cash-on-delivery confirmations send immediately, which makes COD
the easier path for testing email locally.

## Turning on product photographs (optional)

1. Sign up at [cloudinary.com](https://cloudinary.com)
2. Copy the `CLOUDINARY_URL` from your dashboard into `.env.local`
3. Restart `npm run dev`

Photographs are added from the product edit page, and only after the product
has been saved once — an image row needs a product to attach to. Without this
configured the storefront falls back to a brand-tinted placeholder.

## Turning on card payments (optional)

1. Sign up at [razorpay.com](https://razorpay.com) and complete KYC
2. In the dashboard, switch to **Test mode**
3. Go to **Settings → API Keys** and generate a key pair
4. Put them in `.env.local` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`
5. Restart `npm run dev`

Test card: `4111 1111 1111 1111`, any future expiry, any CVV.

Orders stay `PENDING_PAYMENT` until the webhook confirms payment — that's
deliberate, since a browser redirect isn't proof of anything. To test webhooks
locally you need a public URL; [ngrok](https://ngrok.com) is the usual tool.
Point Razorpay's webhook at `https://your-ngrok-url/api/webhooks/razorpay` and
set `RAZORPAY_WEBHOOK_SECRET` to match.

---

## Checking everything still works

```bash
npm test            # 146 tests over the pricing and compliance rules
npm run typecheck   # TypeScript, strict mode
npm run build       # full production build
```

Run these before you push anything. The CI workflow runs the same three.

---

## When something goes wrong

**"JWT_SECRET must be set to at least 32 characters"** — step 3. Generate a real
one with `openssl rand -base64 32`.

**"Can't reach the database"** on every admin page — the connection string is
wrong, or you skipped `npx prisma migrate dev`.

**"Run `prisma generate` first"** — run `npx prisma generate`. This also happens
if you pulled new code that changed the schema.

**"The datasource property `url` is no longer supported in schema files"** —
you're on an older copy of the project. `DATABASE_URL` now gets read from
`prisma.config.ts` at the project root rather than from inside
`prisma/schema.prisma` — that's a Prisma 7 requirement, not a project choice.
The `.env.local` file and every command in this guide are unchanged; re-download
the project if you see this error.

**The homepage loads but there's nothing on it** — that's correct until you add
a product. Seeding creates brands and categories only.

**A product exists but won't add to the basket** — it has no batches with enough
shelf life left. Step 9.

**Fonts look plain** — the app loads them from Google Fonts at runtime, so an
offline machine falls back to system fonts. Everything still works.
