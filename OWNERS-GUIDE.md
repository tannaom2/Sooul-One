# SooulOne — owner's guide

Written for whoever runs the shop day to day, not for the developer. No coding
knowledge assumed.

This covers the parts of the system that make decisions on your behalf, so that
when the site refuses to do something you know why, and whether it's right.

---

## The one rule that will surprise you

**Some stock will be blocked from sale weeks before it expires.**

This isn't a bug. Indian food regulation says that when a food order reaches
the customer, a minimum amount of shelf life must still be left on it. Not at
the moment they order — at the moment it lands on their doorstep.

How much has to be left depends on how long the product lasts in total:

| If the product lasts | It must still have this long left when delivered |
|---|---|
| 10 days | 3 days |
| 2 months | 45 days |
| 6 months | 54 days |
| 1 year | 110 days |

So a namkeen with a one-year shelf life stops being sellable online roughly
**three and a half months before the date printed on the pack.** It is still
perfectly good food. It simply cannot lawfully be shipped.

**This applies to the gummies too, not just the snacks.** Health supplements
count as food under Indian law — that's why they're licensed by the food
regulator rather than the medicines regulator. So a bottle of Biotin Gummies is
subject to the same delivery rule as a pack of namkeen. Worth confirming with
your compliance adviser, but it's the safer assumption and the site is built on
it.

**What to do with that stock:** sell it through the superstores, where this
rule doesn't apply, or discount it well before it reaches that point. The
dashboard warns you in advance — see below.

---

## The two different alerts, and why they're not the same

The dashboard shows two warnings that sound similar and mean different things.

**Low stock** — you're running out. Reorder.

**Near expiry** — this batch is approaching the point where it can no longer be
*shipped*, which as above is well before the printed expiry date. This is your
window to move it through the stores or discount it. Once it passes, the site
will simply stop selling it and the stock sits there.

Treat the near-expiry alert as a deadline, not a heads-up.

---

## Adding a new batch of stock

Every time stock arrives, record it as a **batch** — not just "add 200 to the
count". A batch is a quantity plus a manufacture date plus an expiry date.

This matters for two reasons:

1. The site can only apply the shelf-life rule if it knows which physical stock
   has which expiry date. A single lump count can't tell a fresh pallet from an
   old one.
2. If anything ever has to be recalled, batches are how you answer "which
   customers received the affected stock". Without them, the answer is
   "everyone who bought this product, ever", which is a very different
   conversation with a regulator.

The site always ships the **earliest-expiring** eligible stock first, on its
own. You don't have to manage that.

---

## Adding a product: the form changes shape

The product form asks different questions depending on what you're adding.

**A snack, namkeen or sweet** asks for the nutrition table, the ingredient
list, allergens, vegetarian or non-vegetarian, and total shelf life. None are
optional. All are legally required on the listing itself, not just the pack.

**A gummy** asks instead for supplement facts, servings per container, and
dosage guidance — and your dosage wording must include a "do not exceed"
instruction. The form will reject it otherwise.

This is deliberate. One form with everything optional is how a product ships
with a blank allergen field.

**Vegetarian or not is asked every time and never pre-filled.** For gummies
this depends on whether your formulation uses gelatin (non-vegetarian) or
pectin/agar (vegetarian). Nobody has confirmed which yet. The system will not
guess, because guessing produces a wrong logo on a package.

---

## Why the site rejects some of your product descriptions

Gummies sit under food regulation, not medicine regulation. That draws a hard
line through the copy you can write.

**You may say a product supports something.** Supports immunity. Helps maintain
healthy hair. Supports restful sleep.

**You may not say it treats, cures, prevents or reverses anything.** That
language belongs to licensed medicines. Using it on a supplement is a
regulatory problem regardless of whether the product works.

The form checks your description before it saves and flags wording that crosses
the line, with a suggested rewrite.

Two things to understand about this check:

- **Your category names are fine.** "Hair Fall" and "PMS & Menopause" are
  lawful as menu labels. The risk is in the sentences around them. "Our Hair
  Fall range supports stronger hair" is fine. "Stops hair fall" is not.
- **Passing the check is not legal approval.** It catches the obvious mistakes.
  It cannot read intent and will miss creative phrasings. Copy for the gummies
  brands still needs a human review before it goes live — which is why you have
  to tick the review box before a supplement can be published.

---

## The beverage line — please read before naming it

The regulator has ordered manufacturers to stop using the term **"energy
drink"** on packaging and in marketing, and to drop claims like "boosts
energy". The category still exists and is still legal; its lawful name is
**"caffeinated beverage"**.

The system will refuse to save a product using the banned terms. But this needs
deciding long before anyone opens the product form — it affects the brand name,
the packaging artwork and the print run.

Fixing this now costs a conversation. Fixing it after a packaging run costs the
packaging run.

---

## What the store locator does and doesn't do

The locator shows your superstores: address, hours, map pin, and which brands
each one carries.

**It does not show live stock.** Nowhere on the site does it claim a specific
item is in a specific store right now. That would require connecting the tills
to the website, which is a separate piece of software you'd buy rather than
build. Until then, no stock promises are made about the stores — which is the
honest position, and avoids sending someone across town for something that sold
out an hour ago.

---

## Before you can take a single order

A **Central FSSAI licence** is required for selling food or supplements online,
whatever your turnover. There is no small-business exemption.

It takes real time to come through, so it should be in progress now rather than
after the site is finished. Your 14-digit licence number then appears in the
site footer and on every product listing.

The footer is currently blank where the number goes. It stays blank rather than
showing a placeholder — a made-up licence number is a considerably worse
problem than a missing one.
