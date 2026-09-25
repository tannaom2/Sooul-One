# Getting this to GitHub and onto the internet

Two separate things: putting the code in version control, then deploying it.
Do them in that order — Render deploys *from* GitHub.

---

## Part 1 — Push to GitHub

### 1. Make an empty repository

Go to [github.com/new](https://github.com/new).

- Give it a name (`soulone-platform` is fine)
- Choose **Private** unless you want the code public
- **Do not tick** "Add a README", "Add .gitignore" or "Choose a licence"

That last point matters. Initialising the repo with files creates a commit you'd
then have to merge with, and the first thing you'd hit is a conflict.

### 2. Push from your machine

```bash
cd soulone-platform
git init
git add .
git commit -m "SooulOne commerce platform"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

Replace `YOUR-USERNAME` and `YOUR-REPO`. GitHub shows the exact URL on the page
right after you create the repo.

If you use SSH keys rather than HTTPS, the remote is
`git@github.com:YOUR-USERNAME/YOUR-REPO.git` instead.

### 3. Confirm your secrets didn't go with it

```bash
git ls-files | grep -i env
```

This should print **`.env.example` and nothing else**. If `.env` or `.env.local`
appears, stop and remove them before doing anything else:

```bash
git rm --cached .env .env.local
git commit -m "Remove environment files"
git push
```

`.gitignore` already excludes them, so this should never happen — but a leaked
`DATABASE_URL` or `JWT_SECRET` is worth ten seconds of checking. If one has been
pushed at any point, rotate it rather than just deleting the file. Git keeps
history.

### 4. Working after the first push

```bash
git add .
git commit -m "Describe what changed"
git push
```

CI runs automatically on every push and pull request (`.github/workflows/ci.yml`):
schema validation, lint, typecheck and the 146 tests. A red tick means don't
deploy.

---

## Part 2 — Deploy to Render

### 1. A permanent database first

If you're still on a local database, you need a hosted one.

Sign up at [neon.com](https://neon.com), create a project, copy the connection
string.

**Use Neon or Supabase rather than Render's free Postgres.** Render's free tier
database is deleted after 30 days. Neon's free tier is permanent. The cost
difference is zero and the difference in outcome is your entire order history.

### 2. Create the web service

1. Sign up at [render.com](https://render.com) and connect your GitHub account
2. **New → Web Service**
3. Pick your repository
4. Render reads `render.yaml` and fills in most settings itself

Check these match:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm ci && npx prisma generate && npx prisma migrate deploy && npm run build` |
| Start command | `npm run start` |
| Health check path | `/api/health` |
| Plan | Starter ($7/month) or Free |

The build command runs your migrations on every deploy, so the live database
schema stays in step with the code automatically.

**On the Free plan** the service sleeps after 15 minutes of inactivity and takes
roughly 30 seconds to wake. Fine for showing someone; not fine for real
customers. Starter is $7/month and always on.

### 3. Set the environment variables

In the Render dashboard, **Environment** tab. Every variable in `.env.example`
that you actually use:

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Neon or Supabase, the **pooled** connection string |
| `DIRECT_URL` | The same database's **direct** (unpooled) connection string, used only for migrations |
| `JWT_SECRET` | Render can generate this — click "Generate" |
| `SITE_URL` | Your live URL, e.g. `https://soulone.onrender.com` — used for the sitemap and page metadata |
| `RAZORPAY_KEY_ID` / `_SECRET` | Razorpay dashboard, **live** keys |
| `RAZORPAY_WEBHOOK_SECRET` | You choose it; must match Razorpay's webhook config |
| `SELLER_STATE` | The state you're GST-registered in |
| `NEXT_PUBLIC_FSSAI_LICENCE_NUMBER` | Your 14-digit licence |
| `NEXT_PUBLIC_GSTIN` | Your GSTIN |
| `NODE_ENV` | `production` |

Leave `NEXT_PUBLIC_FSSAI_LICENCE_NUMBER` blank until the licence is actually
issued. The footer will say the licence isn't configured, which is the honest
state. Do not put a placeholder there.

### 4. Create your owner account on the live database

The admin account lives in the database, so a fresh production database has no
way in.

Easiest route: point your local `.env.local` at the **production**
`DATABASE_URL` temporarily and run:

```bash
npm run admin:create
```

Then **change `.env.local` back to your development database**. Forgetting this
is how test orders end up in production.

Alternatively use Render's Shell tab on a paid plan.

### 5. Point Razorpay's webhook at the live site

In the Razorpay dashboard, **Settings → Webhooks → Add**:

- URL: `https://your-app.onrender.com/api/webhooks/razorpay`
- Secret: the same string as `RAZORPAY_WEBHOOK_SECRET`
- Events: `payment.captured`, `payment.failed`, `refund.processed`

Without this, payments will succeed at Razorpay and your orders will sit at
`PENDING_PAYMENT` forever — the app treats the webhook as the only proof of
payment, and the browser redirect as a convenience.

### 6. Near-expiry alert cron job

`render.yaml` declares a second service, `soulone-near-expiry-alert`, that
hits `/api/cron/near-expiry-alert` once a day. The email itself (Section 7.6)
has existed since phase 7 — this is what actually triggers it, so short-dated
stock gets flagged to `OWNER_ALERT_EMAIL` before it becomes unsellable rather
than sitting unnoticed.

Render creates it automatically from `render.yaml` on next deploy. It needs:

- `OWNER_ALERT_EMAIL` set on the **web** service (already required for the
  email to send at all)
- `CRON_SECRET` set to the **same value** on both the web service and the cron
  job — Render generates one for the web service; copy it into the cron job's
  environment tab, since generated values aren't automatically shared across
  services

Without a matching `CRON_SECRET` on both sides, the route returns 401 and the
alert never sends — check the cron job's run logs if batches seem to be
falling through unnoticed.

### 7. Custom domain

**Settings → Custom Domain** in Render, then add the CNAME record it gives you
at your registrar. TLS is issued automatically and free.

Then update `SITE_URL` in Render to the custom domain. The sitemap and
`robots.txt` are generated from it at request time (`src/app/sitemap.ts`,
`src/app/robots.ts`), so there's no file to hand-edit.

---

## Before you take a real order

- [ ] FSSAI Central Licence issued, and the number set in Render
- [ ] GSTIN set
- [ ] Privacy Policy, Terms, Refund and Shipping pages written and linked
      (Razorpay requires these to activate a live account)
- [ ] Razorpay account in **live** mode, not test
- [ ] Webhook configured and a test payment confirmed end to end
- [ ] One real, small, refundable purchase completed — a packaged food item and
      a supplement, since they take different paths through the label and
      compliance logic
- [ ] Every product has its real nutrition, allergen and dosage data
- [ ] Every supplement description reviewed by a person, not just the linter
- [ ] The veg/non-veg mark on every gummy matches the actual formulation

That last one is the easiest to overlook and the most embarrassing to get wrong.

---

## Deploying updates

```bash
git add .
git commit -m "What changed"
git push
```

Render redeploys `main` automatically, but only once CI has passed on that commit
(`autoDeployTrigger: checksPass`). Migrations run in the **pre-deploy** step: after
the build succeeds and before the new version takes traffic. If a migration fails,
the old version keeps running.

### Changing the database schema safely

The new code and the old code both run against the same database for a short
while during every deploy, so every migration must work with **both**. Make
breaking changes in two deploys ("expand, then contract"):

1. **Expand.** Add the new column or table, nullable or with a default. Deploy code
   that writes both old and new, and reads the new with a fallback.
2. **Backfill** existing rows if needed, in a migration or a one-off script.
3. **Contract**, in a later deploy once nothing reads the old one: drop the old
   column or make the new one required.

Never rename or drop a column in the same deploy as the code change. Anything that
deletes data needs a fresh backup first (docs/DR.md).

To roll back, use **Deploys → Rollback** in Render. Note that this reverts the
code but **not** the database — a migration that dropped a column is not undone
by rolling back. Take a backup before any destructive migration.
