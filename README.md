# TurboMarket

TurboMarket is a mobile-first, multi-seller marketplace built inside the original Turbocargologistics Netlify repository. Buyers can browse without an account, sellers can manage listings and orders, and administrators can manage users, listings, payments, platform fees, and payout records.

## Stack

- React 18 and Tailwind CSS loaded from CDNs
- Netlify Functions
- Netlify Database / Postgres
- Stripe Checkout and signed Stripe webhooks
- Optional Resend email delivery

## Environment variables

Set these in Netlify before deploying:

```env
DATABASE_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PUBLIC_APP_URL=https://your-domain.example
OWNER_EMAIL=owner@example.com
RESEND_API_KEY=
PLATFORM_FEE_PERCENT=15
SEED_ADMIN_PASSWORD=change-this-before-seeding
```

`RESEND_API_KEY` is optional. Missing email configuration logs a warning and does not crash the application. Stripe is required only when a buyer starts checkout. The database is required for marketplace data and authentication.

## Database

Marketplace tables are defined in:

```text
netlify/database/migrations/002_marketplace.sql
```

The migration creates users, sessions, sellers, listings, listing images, orders, payments, seller payout ledger entries, and admin settings.

Run the idempotent seed script after the database is available:

```bash
npm install
npm run seed
```

The seed script creates or updates:

- The admin account from `OWNER_EMAIL`
- A sample seller
- A sample listing
- The platform fee setting

Change all seed passwords before production use.

## Local development

```bash
npm install
npx netlify dev --port 8889
```

Open `http://localhost:8889`.

## Stripe setup

1. Add `STRIPE_SECRET_KEY` to Netlify.
2. Create a Stripe webhook endpoint pointing to:

```text
https://YOUR_DOMAIN/api/stripe/webhook
```

3. Subscribe the endpoint to:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `charge.refunded`
4. Add the webhook signing secret as `STRIPE_WEBHOOK_SECRET`.
5. Set `PUBLIC_APP_URL` to the production origin without a trailing slash.

Checkout creates a pending order before redirecting to Stripe. The signed webhook marks the order and payment paid, reduces listing quantity, and creates the seller payout ledger entry. Stripe Connect is not assumed; payout ledger entries clearly state that manual payout is required.

## Routes

Public:

- `/`
- `/login`
- `/register`
- `/listing/:id`
- `/seller/:username`
- `/checkout/success`
- `/checkout/cancel`

Seller:

- `/sell`
- `/seller/dashboard`

Admin:

- `/admin`
- `/admin/users`
- `/admin/listings`
- `/admin/orders`
- `/admin/payments`
- `/admin/sellers`
- `/admin/settings`

All admin paths load the protected admin dashboard. Role checks are enforced by the server API, not only by the browser.

## Production checklist

- Apply the database migration.
- Configure all required environment variables.
- Run the seed script once and replace seed passwords.
- Register and test the Stripe webhook.
- Complete a Stripe test-mode purchase.
- Confirm the order changes from `pending` to `paid`.
- Confirm listing quantity decreases.
- Confirm a payout ledger record is created.
- Switch to Stripe live keys only after test-mode verification.

## Security notes

The former browser-side `admin123` password flow is no longer used. Passwords are PBKDF2-hashed, sessions are stored server-side, cookies are HTTP-only and secure, and owner access is controlled by `OWNER_EMAIL`.
