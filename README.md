# Current Apple OS Versions (v2)

A web app that shows the latest released and beta versions of Apple's operating systems, which devices can run each one, and, for signed-in users, the oldest and newest OS each of their own devices can run. Built with Next.js and deployed on the free tier of Vercel.

This is version 2 of [assign3](https://github.com/r3dw/assign3), a Python and vanilla-JavaScript project that is still deployed separately and unchanged. Version 2 keeps its look and features and adds a database, accounts, and device compatibility.

## Features

- **Current versions** for iOS, iPadOS, macOS, watchOS, tvOS, visionOS, and HomePod Software, with the three supported major versions up front and older ones on request.
- **Betas and release candidates**, including those for older macOS lines, with "New" badges for anything released in the last day or so.
- **Supported devices:** click any OS version for the list of devices that can run it, grouped by category, with each device's first and last release of that version. Includes a filter.
- **My devices** (signed in): pick a category, then a device (grouped by product type, newest first), add a nickname, and see each device's oldest and newest OS and whether that OS still receives updates. The list is private to the account and remembered between visits.
- **Device check:** in Chrome or Edge on a Mac, a banner says whether your own Mac is up to date. It runs entirely in the browser.
- **Themes and accessibility:** light, dark, and terminal themes, adjustable text size, keyboard-accessible controls (screen-reader use has not been tested), and a guided tour on first visit.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | [Next.js](https://nextjs.org/) 16 (App Router), React 19, TypeScript, plain CSS |
| Sign-in | [Clerk](https://clerk.com/): email and a one-time code, no passwords |
| Database | [Supabase](https://supabase.com/) (Postgres) with row-level security |
| Hosting | [Vercel](https://vercel.com/) Hobby (free), including a daily cron job |

### External data sources (all free, no keys)

| Source | Provides |
| --- | --- |
| [endoflife.date](https://endoflife.date) JSON API | Release dates, codenames, and latest release per major version |
| [Apple developer release feed](https://developer.apple.com/news/releases/rss/releases.rss) | The newest releases and betas, read live so they appear before the next import |
| [AppleDB](https://appledb.dev) (`api.appledb.dev`, community-run, MIT licensed) | Every OS build, with betas and RCs and the devices each build runs on, plus the device catalogue |

## How it works

```
 endoflife.date ─┐
 AppleDB ────────┼─ daily import (cron, 06:00 UTC) ─▶ Supabase ─▶ /api/versions ─▶ page
 Apple RSS ──────┘                                       ▲            ▲
                                                         │            └─ Apple RSS, read live on top
 Clerk (email sign-in) ─ token ─▶ /api/my-devices ───────┘  (private rows via row-level security)
```

- **The import** (`src/lib/import/`) reads AppleDB's large files as a stream (the iOS file alone is about 240 MB uncompressed), works out each device's first and last release per OS version, folds hardware variants into single entries (iPhone 8 CDMA and GSM, iPad Wi-Fi and Cellular), and upserts everything. A run takes about 10 to 15 seconds.
- **`/api/versions`** reads the database and overlays Apple's feed. If the database cannot be read, it falls back to endoflife.date, so the page never goes blank. `?source=live` forces that fallback.
- **Caching:** responses are cached at Vercel's edge for an hour (five minutes if a source failed).
- **Privacy:** saved devices are protected by row-level security keyed to the Clerk user id. The server also caps each account at 50 devices.

## Getting started

Full, detailed instructions, including every Clerk and Supabase screen, are in **[docs/SETUP.md](docs/SETUP.md)**. The short version:

```bash
git clone https://github.com/r3dw/assign4.git
cd assign4
npm install
cp .env.example .env.local     # then fill it in; see docs/SETUP.md
npm run dev                    # http://localhost:3000
```

Before sign-in and the database work you need to: create a Clerk application, create a Supabase project, run the three SQL files in `supabase/migrations/` in order, link Clerk to Supabase (third-party auth), and run `npm run import` once to fill the tables.

### Environment variables

| Variable | Public? | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key (`pk_test_...`) |
| `CLERK_SECRET_KEY` | **No** | Clerk secret key (`sk_test_...`), shown only once when created |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Bare project URL, `https://<id>.supabase.co` (no `/rest/v1/`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase publishable (anon) key |
| `SUPABASE_SERVICE_ROLE_KEY` | **No** | Supabase secret (service-role) key; bypasses row-level security, used only by the import |
| `CRON_SECRET` | **No** | Protects `/api/cron/import`. Required on Vercel; optional in `.env.local`. Generate with `openssl rand -hex 32` |

Never commit real values. `.env*` files are gitignored except `.env.example`, and `.claude/settings.json` stops Claude Code from reading them.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm test` | Run the unit tests (Node's built-in test runner, no extra dependencies) |
| `npm run import:dry` | Download the source data and print a summary; writes nothing and needs no keys |
| `npm run import` | Run the import against Supabase (reads `.env.local`) |

TypeScript is checked with `npx tsc --noEmit`. The scripts and tests run TypeScript files directly using Node's built-in type stripping, so use a recent Node release (developed on 24.6).

## API routes

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /api/versions` | Public | Versions, betas, and sources, as JSON |
| `GET /api/os-devices?family=iOS&major=26` | Public | Devices that can run one OS version |
| `GET /api/devices` | Public | The device dropdown (id, name, category, type, release date) |
| `GET/POST/DELETE /api/my-devices` | Signed in | List, add, and remove the user's saved devices |
| `GET /api/me` | Public | Connection check: whether you are signed in and whether the database accepts your token |
| `GET /api/cron/import` | `CRON_SECRET` | The daily import (called by Vercel Cron) |

## Database

Defined in `supabase/migrations/`, run in order:

| Table or view | Holds |
| --- | --- |
| `os_families`, `os_major_versions` | OS families and each major version (codename, release date, end of support, whether still supported) |
| `os_releases` | Every release, beta, and RC, kept as history |
| `devices` | Product catalogue (name, category, type, release date) |
| `device_os_support` | For each device and OS major version, the first and last release it can run |
| `user_devices` | A user's saved devices (private per Clerk user id, row-level security) |
| `device_os_range`, `my_devices` (views) | Each device's oldest and newest OS, and a user's saved devices with those ranges |

## Project layout

```
src/app/                 Pages, global CSS, and the API routes
src/components/          Page UI: cards, dialog, My devices, tour, tooltips, icons
src/lib/                 Version merging, device check, database sources and helpers
src/lib/import/          The import job: streaming reader, AppleDB aggregation, database writes
src/proxy.ts             Clerk's per-request context (Next.js 16 name for middleware)
scripts/import.ts        Command-line runner for the import
supabase/migrations/     Schema, grants, and constraint fixes
docs/SETUP.md            Detailed Clerk, Supabase, and Vercel setup
vercel.json              The daily cron schedule
```

## Testing

`npm test` runs about 70 offline tests covering version parsing and merging, the device check, the streaming JSON reader, the import aggregation and hardware-variant merging, and input validation for saved devices. Beyond that, the interface was checked in headless Chrome on macOS (dark theme, phone width, and estimated iPhone Duo screen sizes) and by hand in a desktop browser; sign-in and the database connection were confirmed on the live site, and saved devices were exercised by hand on localhost.

## Deployment

Pushing to `main` deploys to Vercel. The Vercel project needs the six environment variables above and the **Next.js** framework preset. Setup, the cron secret, and verification steps are in [docs/SETUP.md](docs/SETUP.md#8-deploy-to-vercel).

## Known limitations

- **Device check:** only Chrome or Edge on a Mac can report the OS version; Safari, Firefox, and iPhone and iPad browsers hide it on purpose, so no banner appears there.
- **Not yet checked:** Safari, Firefox, a screen reader, and a real iPhone Duo (layout was tested only at estimated sizes).
- **macOS 10:** all 10.x releases share one "macOS 10" row, so their release lines are not separated.
- **Vintage and obsolete hardware labels** from Apple's support page are not shown. Deriving them from AppleDB's discontinued dates disagreed with Apple's own lists too often, so the feature was left out; a correct version would read Apple's page directly.
- **Free tiers:** a Supabase free project can be paused after about a week of inactivity, and cron on Vercel Hobby runs once a day.
- **Data accuracy:** AppleDB is a community project with no uptime guarantee, and some of its dates and builds are incomplete. endoflife.date's latest release is merged in to fill gaps.

## Credits and licences

- Icons are from [Lucide](https://lucide.dev), used under the ISC License (notice in `src/lib/icons.ts`).
- Device compatibility, betas, and release candidates come from [AppleDB](https://appledb.dev) (`littlebyteorg/appledb`), published under the MIT License. AppleDB's README says parts of its data come from other sources whose licences were not reviewed.
- Release dates and codenames come from [endoflife.date](https://endoflife.date).
- The visual design follows Apple's published design language but uses no Apple-provided assets. This is an unofficial tool and is not affiliated with Apple.
