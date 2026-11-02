# Setup guide: wiring in Clerk and Supabase

This guide takes a fresh clone of the repository to a working app with **Clerk** (sign-in) and **Supabase** (database) connected, locally and on Vercel. It records the steps in the order that works, and the problems that came up along the way.

Dashboards change their menus from time to time. The labels below are what Clerk, Supabase, and Vercel showed in November 2026; if one has moved, search the dashboard for the nearby wording.

**Never paste a secret key into a chat, an issue, a commit, or a screenshot.** Keys go only in `.env.local` (on your machine) and in Vercel's environment variable settings.

---

## 1. What you are building

```
 Browser ──sign in──▶ Clerk                    (email + one-time code, no passwords)
    │                   │
    │                   └─ issues a session token (a JWT whose `sub` is the user's id)
    │
    ├─ page loads ─────▶ Next.js on Vercel ───▶ Supabase ◀── daily import (cron)
    │                     • /api/versions        • reference tables (public read)
    │                     • /api/my-devices ──── • user_devices (private per user)
    │                       sends Clerk's token     Supabase checks the token against
    │                       to Supabase             Clerk, and row-level security keeps
    │                                               each user to their own rows
```

Two things make this work, and both are easy to miss:

1. **Supabase must trust Clerk's tokens.** This is the "third-party auth" link (section 4). Without it, a signed-in user is still an anonymous visitor to the database.
2. **Roles need table privileges as well as row-level security.** Tables created in the SQL Editor are not automatically readable by Supabase's `anon` and `authenticated` roles. The `grants` migration fixes this (section 3).

### What each service does here

| Service | Role | Free tier is enough? |
| --- | --- | --- |
| Clerk | Email sign-in, user accounts. Stores no app data. | Yes (development instance) |
| Supabase | Postgres database: OS versions, releases, devices, per-device OS support, and each user's saved devices. | Yes. A free project may be paused after about a week of inactivity; resume it from the dashboard. |
| Vercel | Hosts the Next.js app and runs the daily import (cron). | Yes (Hobby). Cron jobs on Hobby run at most once a day. |

### Prerequisites

- Node.js: the scripts and tests run TypeScript files directly using Node's built-in type stripping, so use a recent release (developed on 24.6).
- A GitHub account with this repository, and accounts on Clerk, Supabase, and Vercel (all free).
- About 40 minutes.

---

## 2. Clerk

### 2.1 Create the application

1. Sign in at <https://dashboard.clerk.com>.
2. Create an application. The name appears on the sign-in box, so choose something recognisable (this project used "OS Versions").
3. If the creation screen offers sign-in options, choose **Email** only and untick everything else. You can also set this up afterwards (next step).
4. Ignore the quickstart page that follows ("Add authentication to your app"). Its agent and CLI instructions would add Clerk to your project themselves; this repository already contains the integration.

You now have a **development instance**, shown as "Development" in the top bar. That is the right choice for this project: it works on `localhost` and on `*.vercel.app`. A production instance needs your own domain.

### 2.2 Email-only sign-in

Open **Configure → User & authentication**. There is a row of tabs: Email, Phone, Username, Password, Passkeys, Biometric, User model. A green dot beside a tab means it is switched on.

| Tab | Setting |
| --- | --- |
| **Email** | **Sign-up with email**, **Require email address** and **Verify at sign-up** on. Under verification methods choose **Email verification code** (leave **Email verification link** off). **Sign-in with email** on, with **Email verification code** on. |
| **Phone** | Off |
| **Username** | Off |
| **Password** | Off. People sign in with a code, so there is no password to store or reset. |
| **User model** | Defaults are fine (first and last name optional). |

Then open **Configure → User & authentication → SSO connections**. The list should say "No connections added". Remove any social provider (Google is often on by default).

When this is done, only Email and User model show green dots.

### 2.3 Get the two keys

Open **Configure → Instance → API keys**.

| Key | Looks like | Goes in | Public? |
| --- | --- | --- | --- |
| Publishable key | `pk_test_...` (about 55 characters) | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes. It is sent to every browser. |
| Secret key | `sk_test_...` (about 50 characters) | `CLERK_SECRET_KEY` | **No.** Server only. |

> **The secret key can only be copied once.** Clerk shows the full value when a key is created and never again. A key listed as `default` with "Never used" cannot be revealed, and the lock icon beside it opens an IP allowlist dialog, not a reveal. If you have no copy:
>
> 1. Click **Add new key** beside the Secret keys heading.
> 2. Name it (for example `assign4-local`) and leave any IP allowlist empty.
> 3. Copy the full value **immediately**, before closing the dialog, and paste it into `.env.local` (section 5).
>
> A 14-character value means you copied the masked display. Real keys are about 50 characters. Once the new key works, delete the old unused one.

**Leave the IP allowlist empty.** It is a paid (Business) option that restricts the key to listed addresses, and Vercel's servers have no fixed addresses, so an allowlist would break the deployed site.

---

## 3. Supabase

### 3.1 Create the project

1. Sign in at <https://supabase.com/dashboard> and create a project (any region near you; save the database password in a password manager, though this app never uses it).
2. Wait for it to finish provisioning.

### 3.2 Run the migrations, in order

The database is defined by three SQL files in `supabase/migrations/`. Run them **in filename order**:

1. In the project, open **SQL Editor** and click the **+** tab to start a new query. (There is no "New query" button; the **+** is it.)
2. Paste the whole contents of one file and click **Run**. Success reads "Success. No rows returned".
3. Repeat for the next file.

| Order | File | What it does |
| --- | --- | --- |
| 1 | `20261027000000_initial_schema.sql` | Creates the tables (`os_families`, `os_major_versions`, `os_releases`, `devices`, `device_os_support`, `user_devices`), two views (`device_os_range`, `my_devices`), and the row-level-security policies. |
| 2 | `20261101000000_grants.sql` | Grants `anon`, `authenticated` and `service_role` the table privileges they need. **Do not skip this.** See the box below. |
| 3 | `20261101000100_release_constraints.sql` | Fixes two constraints on `os_releases` so the import can be re-run without creating duplicates and can store unnumbered release candidates. |

**Check:** open **Table Editor**, choose the `public` schema, and you should see the six tables and two views (eye icons).

> **Why the grants migration exists.** Row-level security decides *which rows* a role may touch, but a role also needs the basic privilege on the table. Without the grants, a signed-in request fails with:
>
> ```
> permission denied for table user_devices   (code 42501)
> ```
>
> even though Clerk's token was accepted. The hint in the error names the missing `GRANT`. If you add a table later, add its grants too.

### 3.3 Get the URL and keys

Open **Project Settings → API** (also called **API Keys** or **Data API**).

| Value | Looks like | Goes in | Public? |
| --- | --- | --- | --- |
| Project URL | `https://<project-id>.supabase.co` | `NEXT_PUBLIC_SUPABASE_URL` | Yes |
| Publishable key (older name: anon key) | `sb_publishable_...` (about 46 chars) or an `eyJ...` JWT | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes. Row-level security protects the data. |
| Secret key (older name: service-role key) | `sb_secret_...` (about 41 chars) or an `eyJ...` JWT | `SUPABASE_SERVICE_ROLE_KEY` | **No.** It bypasses all security rules. |

- **The variable names use the older terms** ("anon", "service role"). The newer `sb_publishable_` and `sb_secret_` keys go in the same variables.
- **The URL must not end in `/rest/v1/`.** That is only the path to the database API, which the Supabase library adds itself. A URL with it appended makes every request fail. Use exactly `https://<project-id>.supabase.co`, with no trailing slash and no quotes.
- The secret key is used only by the server-side import job. It is never sent to the browser.

---

## 4. Link Clerk and Supabase

This is the step that lets Supabase recognise a signed-in user. The Clerk user id arrives in the database as the token's `sub` claim, and the row-level-security policies compare it with `user_devices.user_id`:

```sql
using ((select auth.jwt() ->> 'sub') = user_id)
```

Do both halves.

**In Clerk**

1. Open **Configure → Integrations** (it may be under Developers) and choose **Supabase**.
2. Click **Activate**.
3. Copy the **Clerk domain** shown, which looks like `something.clerk.accounts.dev`. It is a public address, not a secret.

**In Supabase**

1. Open **Authentication → Sign In / Providers → Third-Party Auth**.
2. Click **Add provider**, choose **Clerk**, and paste the Clerk domain.
3. Save.

**How the app uses it:** `src/lib/supabase.ts` builds the user's Supabase client with Clerk's session token as its access token:

```ts
createClient(url, anonKey, { accessToken: async () => (await auth()).getToken() })
```

Every request from `/api/my-devices` therefore acts as the signed-in person. The route code adds friendly errors and a 50-device cap, but access control comes from the database, not from the route.

---

## 5. Local environment file

Create `.env.local` in the project root (it is gitignored). The fastest way is to copy the template and fill it in:

```bash
cp .env.example .env.local
```

Then edit it. **Every value below is fake:**

```bash
# --- Clerk -------------------------------------------------------------
# Public: sent to the browser (starts with pk_)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_EXAMPLEexampleEXAMPLEexample
# Private: server only (starts with sk_)
CLERK_SECRET_KEY=sk_test_EXAMPLEexampleEXAMPLEexample

# --- Supabase ----------------------------------------------------------
# Public: the bare project URL, no /rest/v1/
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
# Public: publishable (anon) key
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_EXAMPLEexample
# Private: secret (service-role) key. Bypasses row-level security.
SUPABASE_SERVICE_ROLE_KEY=sb_secret_EXAMPLEexample

# --- Daily import endpoint (optional locally) ----------------------------
# Private: protects /api/cron/import. Generate your own (see "Generating
# CRON_SECRET" below). Needed here only to test that endpoint with `npm run dev`;
# the deployed site reads its own copy from Vercel (section 8.3).
CRON_SECRET=EXAMPLE_not_a_real_secret_generate_your_own_with_openssl
```

Rules for the file:

- `NAME=value` on one line, with **no spaces around `=` and no quotes**.
- A `NEXT_PUBLIC_` prefix means the value is bundled into the browser code and visible to everyone. Never give that prefix to a secret.
- Restart `npm run dev` after editing; it reads the file only at startup.
- Check what you pasted by **prefix and length**, not by looking at the key: `pk_test_` and `sk_test_` for Clerk, `https://` and `.supabase.co` for the URL.
- `CRON_SECRET` is **optional on your machine**. Leave the line out and everything works except calling `/api/cron/import` locally. (`.env.example` does not list it.)

### Generating `CRON_SECRET`

`CRON_SECRET` is not issued by any dashboard. It is a password you invent, and the quickest way to make a strong one is:

```bash
openssl rand -hex 32
```

That prints 64 random hexadecimal characters, for example `9f2c...e41a` (yours will differ). Copy the output into the file after `CRON_SECRET=`, with no quotes or spaces. The same command generates the Vercel copy (section 8.3).

- **Use a different value locally than on Vercel.** The two do not need to match: Vercel sends its own value when the cron job runs, and your local copy is only compared against requests you make yourself. Separate values mean a leaked `.env.local` does not expose production.
- **Testing the endpoint locally** (this runs the real import against your Supabase project):

  ```bash
  npm run dev
  curl -H "Authorization: Bearer <your-local-cron-secret>" http://localhost:3000/api/cron/import
  ```

  Expect `{"ok":true, ...}`. A wrong or missing header gives `unauthorized`, and a missing `CRON_SECRET` gives `CRON_SECRET is not set`.

> **Working with Claude Code.** The repository's `.claude/settings.json` denies Claude Code permission to read `.env*` files, so it never sees your keys. If it needs a command that loads them (such as the import), run it yourself with the `!` prefix, for example `! npm run import`.

---

## 6. Run it locally and test the connection

```bash
npm install
npm run dev          # http://localhost:3000
```

1. Open <http://localhost:3000>. The page should load the OS cards.
2. Click **Sign in**, enter your email, then the code Clerk emails you. A new address creates the account. The button becomes your avatar.
3. Open <http://localhost:3000/api/me>. This route reports what the server and database can see:

   ```json
   {"signedIn":true,"userId":"user_...","supabase":"ok","status":200,"deviceRows":0}
   ```

   Signed out, it returns `{"signedIn":false}`.

### If `/api/me` is not `ok`

| You see | Cause | Fix |
| --- | --- | --- |
| `signedIn: false` after signing in | Clerk keys missing or from another application | Re-check the two Clerk values; restart the dev server |
| `permission denied for table user_devices`, code `42501` | Grants migration not run | Run `20261101000000_grants.sql` (section 3.2) |
| An error about the JWT, or HTTP 401 from Supabase | Supabase does not trust Clerk | Redo section 4 on both sides; the Clerk domain must match exactly |
| Connection error, or a 404 | URL wrong | Remove `/rest/v1/` and any trailing slash from `NEXT_PUBLIC_SUPABASE_URL` |
| `Invalid API key` | Wrong or truncated Supabase key | Copy it again from Project Settings → API |
| Clerk errors about an invalid secret key | Key truncated (14 characters) | Create a new secret key and copy it immediately (section 2.3) |

(`/api/me` uses a plain query, not a count-only one, because Supabase hides the error text for count-only requests.)

---

## 7. Load the data

The tables start empty. The import job fills them from AppleDB, endoflife.date, and Apple's developer RSS feed.

```bash
npm run import:dry   # downloads and summarises; writes nothing; needs no keys
npm run import       # writes to Supabase (reads .env.local)
```

Expect roughly: 80+ major versions, about 5,000 releases (including betas and release candidates), about 490 devices, and about 1,500 device-support rows. The counts drift as AppleDB changes. A run takes 10 to 15 seconds and uses about 280 MB, because the large AppleDB files are read as a stream and never held whole.

- **Safe to repeat.** Every write is an upsert, and rows that no longer exist upstream are removed. Run it twice and the table counts should not change; if the releases count doubles, migration 3 was not applied.
- **A Node warning about `MODULE_TYPELESS_PACKAGE_JSON` is harmless.** It only means Node had to detect that the script uses import syntax.
- Merged hardware variants (iPhone 8 CDMA and GSM, iPad Wi-Fi and Cellular, watch case sizes) become one device, but only when they share a name and the same newest supported OS. Saved devices are never deleted by the import.

**Check:** reload the page. All seven OS families should appear, including HomePod Software, and **Supported devices** under any card should open a device list. In the Supabase SQL Editor:

```sql
select
  (select count(*) from os_major_versions) as majors,
  (select count(*) from devices)           as devices,
  (select count(*) from os_releases)       as releases,
  (select count(*) from device_os_support) as support;
```

---

## 8. Deploy to Vercel

### 8.1 Create the project

1. In Vercel choose **Add New → Project** and import the GitHub repository.
2. The framework preset should read **Next.js** (it is detected automatically).
3. Add the environment variables (next section) before or immediately after the first deploy. Sign-in and the database do not work without them, and a build that includes Clerk may fail if the publishable key is missing.

### 8.2 Environment variables

Open **Settings → Environment Variables** and add all of these:

| Name | Type | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Config | Public |
| `NEXT_PUBLIC_SUPABASE_URL` | Config | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Config | Public |
| `CLERK_SECRET_KEY` | **Secret** | |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | |
| `CRON_SECRET` | **Secret** | Required on Vercel (section 8.3). Optional in `.env.local` (section 5). |

For each, tick **Production** and **Preview** (and **Development** if offered). A variable not ticked for Preview breaks sign-in on branch previews.

Tips:

- **Paste a whole `NAME=value` line into the Key field.** Vercel splits it at the `=` and fills in the value for you, so you can paste lines straight from `.env.local`.
- **Pasting a secret flips its Type to Config.** After pasting `CLERK_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, set the Type back to **Secret** by hand. A Secret variable cannot be revealed after saving, which is what you want.
- Variables apply to the **next** deployment. After adding or changing any, redeploy.

### 8.3 The daily import (cron)

`vercel.json` schedules `GET /api/cron/import` every day at 06:00 UTC. The route writes with the service-role key, so it refuses any request without the right secret:

1. Generate a random value with `openssl rand -hex 32` (64 hexadecimal characters; see "Generating `CRON_SECRET`" in section 5). Make a **new** value for Vercel; do not reuse your local one.
2. Add it in Vercel as `CRON_SECRET` (type Secret), then redeploy. Keep a copy somewhere safe: you will need it to run the `curl` test below, and Vercel cannot show it again.
3. Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when it runs the job.

Test it without waiting for 06:00:

```bash
curl -H "Authorization: Bearer <your-secret>" https://<your-site>/api/cron/import
```

You should get `{"ok":true, ...}` with the same log lines as the local import (it takes somewhat longer on Vercel than locally, because the downloads are slower there). Without the header it answers `unauthorized`; with no `CRON_SECRET` set it answers `CRON_SECRET is not set`.

### 8.4 Verify the live site

1. Open the site: the OS cards load and HomePod Software is present.
2. Sign in, then open `/api/me` on the live URL: `supabase: "ok"`.
3. Add and remove a device under **My devices**, and reload to confirm it was remembered.

---

## 9. Where it lives in the code

| Concern | File |
| --- | --- |
| Clerk provider wrapped around the app | `src/app/layout.tsx` |
| Per-request Clerk context (nothing is blocked; the page is public) | `src/proxy.ts` |
| Sign in button and avatar | `src/components/VersionsApp.tsx` (`<Show when="signed-in">` and `<SignInButton>`) |
| Supabase clients: public, signed-in user, and service-role | `src/lib/supabase.ts` |
| Saved devices (list, add, remove) | `src/app/api/my-devices/route.ts` |
| Device dropdown data | `src/app/api/devices/route.ts` |
| Connection check | `src/app/api/me/route.ts` |
| Import job and daily endpoint | `src/lib/import/`, `scripts/import.ts`, `src/app/api/cron/import/route.ts` |
| Schema, policies, grants | `supabase/migrations/` |

Version notes that differ from older tutorials:

- **Clerk 7:** `<SignedIn>` and `<SignedOut>` were removed. Use `<Show when="signed-in">` and `<Show when="signed-out">`.
- **Next.js 16:** `middleware.ts` is now `proxy.ts`. `AGENTS.md` points to the documentation bundled in `node_modules/next/dist/docs/`.

### Security model in one page

- The browser holds only the public values: the Clerk publishable key, the Supabase URL, and the Supabase publishable key.
- The Supabase **publishable key is safe to expose** because every table has row-level security on. Reference data (versions, devices) is readable by everyone and writable by no one except the service role. `user_devices` is readable and writable only for rows whose `user_id` equals the caller's Clerk id.
- The **service-role key** exists only in server code that runs the import (`createAdminClient`), and in Vercel and `.env.local`. It is never prefixed `NEXT_PUBLIC_`.
- The private API routes return **401** to anonymous callers, and each user can hold at most **50** saved devices.
- If a secret leaks, **rotate it** in the Clerk or Supabase dashboard and update `.env.local` and Vercel. Removing it from a commit does not make it safe; it stays in git history.

---

## 10. Troubleshooting

| Problem | Likely cause and fix |
| --- | --- |
| Build fails on Vercel with a Python error (`PYTHON_ENTRYPOINT_NOT_FOUND`) | The framework preset is wrong. Version 1 (assign3) needed the "Other" preset; this project needs **Next.js**. |
| Sign-in works locally but not on Vercel | A variable is missing for the environment (Production or Preview), or you have not redeployed since adding it. |
| Sign-in works on the live site but `/api/me` shows an error | The Vercel Supabase variables differ from `.env.local`, or the Clerk-Supabase link (section 4) was done on a different Clerk application. |
| The page shows data but no HomePod or betas | The import has not run, so the database is empty and the page fell back to endoflife.date. Check **Data sources** at the bottom of the page. |
| `/api/cron/import` returns 401 | The `Authorization` header does not match `CRON_SECRET`, or the secret was added without redeploying. |
| Supabase calls fail after a quiet week | A free project can be paused. Open the dashboard and resume it. |
| The dropdown still shows both "iPhone 8 (CDMA)" and "(GSM)" | The import with variant merging has not been run against this database. Run `npm run import` once. |
| `next dev` complains about a missing publishable key | `.env.local` is missing, misnamed, or the server was not restarted. |

## 11. Checklist

- [ ] Clerk: email code only; no password, phone, username, or social sign-in
- [ ] Clerk: new secret key copied in full (about 50 characters)
- [ ] Supabase: three migrations run in order; six tables and two views visible
- [ ] Supabase URL has no `/rest/v1/`
- [ ] Third-party auth: Clerk added in Supabase, Supabase activated in Clerk
- [ ] `.env.local` filled in; `/api/me` shows `supabase: "ok"` when signed in
- [ ] `npm run import` run; second run leaves the counts unchanged
- [ ] Vercel: six variables set (secrets marked Secret), environments ticked, redeployed
- [ ] `CRON_SECRET` generated with `openssl rand -hex 32`, set in Vercel (and, optionally, in `.env.local`), and the cron endpoint tested with `curl`
- [ ] Live site: sign in, `/api/me`, and add and remove a saved device all work
