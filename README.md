# Turbocargologistics

A premium shipping & logistics marketing site with a database-backed shipment
tracking dashboard. Customers can browse services, estimate shipping rates, and
track packages, while an admin dashboard manages the shipment list.

## Features

- **Marketing pages** — Home, Services, Rates calculator, and Contact.
- **Track** — Search and filter live shipments by ID, origin, destination, or status.
- **Admin dashboard** — Add and delete shipments, view summary stats, and export
  the shipment list to CSV. (Demo login password: `admin123`.)
- **Persistent storage** — Shipments are stored in a Netlify (managed Postgres)
  database and served through a Netlify Function, so data is shared across all
  visitors and survives page reloads.

## Tech stack

- **Frontend** — A single static `public/index.html` page using React 18 and
  Tailwind CSS loaded from CDNs (no build step). JSX is compiled in the browser
  with Babel Standalone.
- **Backend** — A Netlify Function (`netlify/functions/shipments.ts`) exposing a
  small REST API at `/api/shipments`.
- **Database** — Netlify Database (Postgres) via the native `@netlify/database`
  driver. Schema lives in `netlify/database/migrations/`.

## API

`/api/shipments`

- `GET` — list all shipments (newest first)
- `POST` — create a shipment (`{ id, origin, destination, weight, status }`)
- `DELETE /api/shipments?id=<id>` — delete a shipment

## Running locally

This project is designed to run on Netlify. To run it locally with full feature
emulation (functions + database), use the Netlify CLI:

```bash
netlify dev --port 8889
```

Then open http://localhost:8889. The database is provisioned automatically on
first connection and seeded with a few demo shipments via the initial migration.

> Note: There is no client build step — `public/index.html` is served as-is.
> Dependencies in `package.json` are only needed for the serverless function and
> are installed automatically by the Netlify build.
