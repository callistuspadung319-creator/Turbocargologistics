# AGENTS.md

Guidance for AI agents working on the Turbocargologistics project.

## What this is

A static React (CDN, no build) marketing + tracking site for a fictional shipping
company, backed by a Netlify Function and a Netlify Postgres database for shipment
data.

## Architecture

- `public/index.html` — The entire frontend. A single self-contained HTML file:
  React 18, ReactDOM, Tailwind, and Babel Standalone are loaded from CDNs, and all
  app code lives in one in-browser-compiled `<script type="text/babel">` block.
  There is **no bundler or build step** for the frontend — edit the HTML directly.
  Client-side "routing" is just a `currentPage` state switch.
- `netlify/functions/shipments.ts` — REST API for shipments at `/api/shipments`
  (GET list / POST create / DELETE by `?id=`). Uses the native `@netlify/database`
  driver (`getDatabase()` + `db.sql` tagged templates). The route is declared via
  the function's `export const config = { path: [...] }`.
- `netlify/database/migrations/` — SQL migrations applied automatically by Netlify
  at deploy time. `0001_create_shipments.sql` creates the `shipments` table and
  seeds demo rows.
- `netlify.toml` — Publishes `public/` and points functions at `netlify/functions`.
- `package.json` — Declares only the function's runtime deps. Installed by Netlify
  during build; **do not run `npm install` or any build command locally.**

## Data model

`shipments` table: `id` (text PK), `status`, `origin`, `destination`, `weight`,
`progress` (int), `created_at`, `updated_at`. The frontend derives the relative
"x ago" label and display date from `created_at` (see `timeAgo`/`normalize`).

## Conventions & non-obvious decisions

- **Native driver, not Drizzle.** This project uses `@netlify/database`'s `db.sql`
  rather than Drizzle ORM, so schema changes are hand-written SQL migration files
  in `netlify/database/migrations/`. Never apply migrations yourself — Netlify does
  it on deploy. Never run DDL through `netlify db connect`.
- **Admin auth is demo-only.** The `admin123` password gate is purely client-side
  and not a real security boundary. The API has no auth. If real protection is
  needed, move auth server-side (e.g. Netlify Identity) and guard the function.
- **Status → progress.** New shipments get a default progress based on status
  (Processing 15 / In Transit 65 / Delivered 100), set in the function.
- Keep the frontend dependency-free of any build tooling; match the existing
  inline-React style when editing `public/index.html`.

## Adding a schema change

1. Edit/add a SQL file in `netlify/database/migrations/` with a higher numeric
   prefix (e.g. `0002_...sql`). Never modify an already-applied migration.
2. Update the function queries accordingly.
3. Let the Netlify deploy apply the migration.
