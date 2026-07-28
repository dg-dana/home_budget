# Architecture

Reference for how this app is put together and why. Read this before extending it.

---

## 1. What the app is

- A household finance + shopping web app, with **two deliberately different kinds of access**:
  - **Members** — have accounts, belong to exactly one household, share all of its data.
  - **Guests** — have *no account*. They reach a single shopping list via a share link and nothing else.
- That two-tier access is the defining constraint of the whole design. Most decisions below exist to serve it.
- One household per user. There is no cross-household anything, no user switching between households.

---

## 2. Shape of the system

- **npm workspace monorepo**, two packages:
  - `server/` — Express + TypeScript API, also serves the built frontend in production.
  - `web/` — React + TypeScript SPA built with Vite.
- **Development**: two processes. API on `:4000`, Vite dev server on `:5173`. Vite proxies `/api` → `:4000` so the session cookie stays same-origin (no CORS, no cross-site cookie problems).
- **Production**: one process, one port. `npm run build` emits `server/dist` + `web/dist`; Express serves `web/dist` statically with an SPA fallback to `index.html`.
- **No CORS config anywhere by design** — same-origin in both modes. If you ever split the domains, that assumption breaks and cookies need `SameSite=None; Secure`.
- **Responses are gzipped** (`compression` middleware, mounted before the routes and the static handler so it covers both). JSON built from repeated field names and ISO dates compresses roughly 11x: a month of expenses goes from 47 kB to 4 kB, and the frontend bundle from 225 kB to 69 kB. Small responses are left alone, since compressing them costs more than it saves.

---

## 3. Data layer

- **SQLite via `better-sqlite3`**, single file at `DATABASE_PATH` (default `data/home-budget.sqlite`).
- **Synchronous driver, on purpose.** All query calls are blocking, which is why most route handlers are plain sync functions. Only bcrypt is async.
- WAL journal mode; `foreign_keys = ON` enforced per connection.
- **Migrations run on every boot**, from the ordered list in `server/src/migrations.ts`. Each one runs inside a transaction and is recorded in `schema_migrations`; a database that is already current does no work beyond one `SELECT`.
  - **Never edit or reorder a migration that has shipped** — add a new one. Ids are what get recorded, so they must stay stable.
  - Migration `001-initial-schema` is the original schema and is entirely `IF NOT EXISTS`. That is deliberate: it means a database created *before* the migration system existed passes over it harmlessly and picks up later migrations cleanly. There is a test for exactly this adoption path.
- `data/` is gitignored. **Do not back it up with `cp`** — in WAL mode that can produce a snapshot missing recent writes, or a corrupt one. Use `npm run backup` (§11).

### Tables

- `households` — id, name, currency. The top-level tenant.
- `users` — belongs to a household, has `role` of `owner` or `member`. Email is globally unique.
- `invites` — single-use tokens for adding members. Carries `used_at`/`used_by`, `expires_at`, optional pinned `email`.
- `categories` — per household, unique name, colour, optional `monthly_budget_cents`.
- `expenses` — per household. FKs to category and to the paying user.
- `recurring_expenses` — per household. A rule (amount, frequency, start/end) plus `last_generated_on`, the marker that makes generation idempotent.
- `shopping_lists` — per household. Holds the nullable `share_token` and the `share_can_edit` flag.
- `shopping_items` — per list. Records `added_by_name` and `checked_by_name` as **plain text, not FKs** — because a guest with no account may have set them.
- `password_resets` — single-use recovery tokens. Cascades with the user, so a link cannot resurrect a deleted account.

### Deletion behaviour (deliberate)

- Delete a household → cascades to everything under it.
- Delete a list → cascades to its items.
- Delete a **member** → their expenses survive; `paid_by` / `created_by` go `NULL`. History is never destroyed by removing a person.
- Delete a **category** → its expenses survive and show as "Uncategorised".
- Delete a **recurring rule** → the expenses it already generated survive and lose their `recurring_id`. They record money that really was spent.

### Money

- **Always integer cents (`amount_cents`, `monthly_budget_cents`). Never floats, never at any layer.**
- Conversion happens at exactly two boundaries: the API accepts major units and does `Math.round(amount * 100)`; the UI divides by 100 only to display via `Intl.NumberFormat`.
- Currency is a household-level setting; it is a display concern only, never converted between currencies.

---

## 4. Authentication

- Passwords: **bcrypt, 12 rounds** (`bcryptjs`, pure JS — no native build step).
- Sessions: **JWT in an httpOnly cookie** named `hb_session`, `SameSite=Lax`, `Secure` in production, 30-day expiry. Not readable from JavaScript; there is no token in `localStorage`.
- The JWT carries `sub` (user id) and `gen` (session generation). **The user row is re-read from the DB on every request**, so role changes and member removal take effect immediately rather than waiting for the token to expire.
- Login returns an identical error for unknown-email and wrong-password, so the endpoint cannot be used to enumerate accounts.
- `NODE_ENV=production` **refuses to boot** without a real `JWT_SECRET`.

### Passwords and session invalidation

- Two ways to change a password: **self-service** (`POST /auth/password`, requires the current one) and an **owner-issued recovery link** for someone locked out (`POST /household/members/:id/reset-password` → `/reset/:token`).
- There is no email provider, so the owner passes the recovery link on themselves — the same shape as invites. Links are single-use, expire in 24 hours, and issuing a new one retires any outstanding link for that person.
- **Changing a password invalidates every existing session for that user.** `users.session_generation` is bumped, and a token whose `gen` no longer matches is refused. Without this, resetting a compromised password would leave the attacker's stolen cookie working until it expired on its own.
- **It is a counter, not a timestamp.** A JWT's `iat` has one-second resolution, so a timestamp cutoff cannot tell the session being issued *by* the password change from one stolen a moment earlier — the first implementation did use a timestamp, and it produced a genuinely flaky test. A counter removes the clock from the question entirely.
- The device doing the change is handed a fresh cookie in the same response, so it stays signed in while every other device is evicted.

### Middleware (`server/src/auth.ts`)

- `requireAuth` — attaches `req.user`, else 401.
- `optionalAuth` — attaches `req.user` if present, never rejects.
- `requireOwner` — must run after `requireAuth`; restricts to the household owner.
- `currentUser(req)` — narrows `req.user` for handlers already behind `requireAuth`.

---

## 5. Authorization model

- **Owner only**: household settings, create/revoke invites, remove members.
- **Any member**: categories, expenses, shopping lists, sharing controls.
- **Guest (share token only)**: read one list; add/edit/tick/delete its items, and only while `share_can_edit` is on.

### The invariant that matters most

- **Every household-scoped query filters on the caller's `household_id` in the SQL itself** — not in a post-fetch check.
- Ids supplied by the client are never trusted. `assertOwned()` in `routes/expenses.ts` verifies a `categoryId`/`paidBy` belongs to the caller's household before it is stored.
- Consequence: a valid id from another household behaves as "not found", never as a leak.
- **If you add a route, it must keep this property.** This is the single easiest thing to get wrong here.

---

## 6. The sharing mechanism

- A list's `share_token` is 24 random bytes (`crypto.randomBytes(24).toString('base64url')`), nullable. `NULL` = not shared.
- Guest routes live under `/api/share/:token` and are mounted **without any auth middleware**. That is intentional, not an oversight.
- The guest response is deliberately narrow: `{ name, canEdit, items }`. No household name, no member names, no ids beyond item ids, no other lists.
- **Revocation is instant** — setting `share_token = NULL` makes the old URL 404 on the very next request. No token blocklist needed.
- Re-enabling sharing **reuses the existing token** so links already sent out keep working; only an explicit *Stop sharing* invalidates them.
- `share_can_edit = 0` gives a view-only link: reads pass, all mutations 403.
- Guests identify themselves with a free-text `guestName` in the request body, persisted to `localStorage` on their device. It is a **label, not an identity** — it is never authenticated and must never be used for any access decision.

---

## 7. Recurring expenses

A rule in `recurring_expenses` (rent, a bill, a subscription) turns itself into
real rows in `expenses`. The rows are ordinary expenses — they count towards
budgets, totals and the trend like anything else — and carry a `recurring_id`
so the UI can badge them.

### Generation happens on read, not on a schedule

- `materialiseDueExpenses(householdId)` runs at the top of `GET /expenses`, `GET /expenses/summary` and the recurring routes.
- **Why not a scheduler:** the app is a single SQLite process that may simply not be running when a rule falls due. A cron would still need a catch-up path for that case, so the catch-up path *is* the implementation. Nothing is lost while the server is off — the occurrences appear the next time someone opens the app.
- **Idempotency comes from `last_generated_on`**, the date of the most recent materialised occurrence. Generation only ever considers dates strictly after it. Running twice creates nothing the second time; there is a test that asserts this.
- The cost when nothing is due is one indexed query.
- Trade-off to be aware of: a GET request can write. It is bounded and idempotent, but it does mean read endpoints are not side-effect free.

### The date maths

- `occurrenceAt(rule, n)` is **pure** and works on `YYYY-MM-DD` strings, so there is no timezone to get wrong. It is tested directly, without HTTP or a database.
- Monthly and yearly steps keep the start date's day-of-month and **clamp** to the target month. Clamping never moves the anchor: a rule starting on the 31st goes 31 Jan → 28 Feb → 31 Mar, *not* 28 Feb → 28 Mar. This is the classic bug in recurrence code and there is a test named for it.
- 29 February yearly rules fall back to the 28th in non-leap years and return to the 29th when one comes round.

### Pause, resume and edits

- Pausing sets `is_active = 0`; nothing generates while paused.
- **Resuming skips the paused window** rather than dumping months of back-dated expenses on the household. It does this by advancing `last_generated_on` to yesterday, which leaves an occurrence falling *today* still due.
- Moving a rule's start date later than `last_generated_on` clears that marker, so the shifted schedule is not silently skipped.
- Deleting a rule keeps the expenses it created (`ON DELETE SET NULL`).

---

## 8. Server code map (`server/src/`)

- `app.ts` — `createApp()`: assembles the Express app (routes, static frontend, error middleware last) **without binding a port**, so tests can mount it on an ephemeral one.
- `index.ts` — the entry point. Only calls `createApp().listen(...)`.
- `config.ts` — env parsing, resolves paths relative to repo root, production guardrails.
- `db.ts` — connection + the migration runner.
- `migrations.ts` — the ordered, append-only migration list.
- `recurring.ts` — recurrence date maths (pure) and materialisation.
- `auth.ts` — hashing, cookies, id/token generation, auth middleware, `setPassword`.
- `http.ts` — `HttpError` + status helpers, `asyncHandler`, `parseBody`, error middleware.
- `rateLimit.ts` — in-process fixed-window limiter.
- `backup.ts` — consistent snapshots via SQLite's online backup API.
- `shoppingItems.ts` — **item operations shared by both the member and guest routes.** Both paths call the same functions with a different `actorName`, so guest and member edits can never diverge in behaviour.
- `routes/` — `auth`, `household`, `categories`, `expenses`, `recurring`, `lists`, `share`.

### Conventions to follow

- Throw `HttpError` (or `badRequest`/`notFound`/`forbidden`/…) from anywhere; the error middleware turns it into JSON. Do not hand-roll `res.status(...).json({error})`.
- Wrap every handler in `asyncHandler` — including sync ones, for uniformity.
- Validate all input with a Zod schema through `parseBody`. `parseBody` is generic over the schema so `.default()` resolves to the *output* type.
- Multi-statement writes go in `db.transaction(...)` (see register and join).

---

## 9. Frontend (`web/src/`)

- React 18, React Router 7, **no state-management library and no data-fetching library**. Deliberate: the app is small and every page's data is scoped to one screen.
- Per-page pattern: `useState` + a `load()` callback + `useEffect`. Mutations call the API then re-run `load()`. **Refetch rather than mutate local state** — it keeps guest/member concurrency honest at the cost of an extra request.
- `api.ts` — thin typed `fetch` wrapper; unwraps `{error}` bodies into `ApiError` carrying the status. Also the single home for all response type definitions.
- `session.tsx` — the only global state. Holds `user` + `household`, hydrates from `GET /auth/me` on mount, treats a 401 as "signed out" rather than an error.
- `format.ts` — money and date helpers. **Month/day helpers use local time, not UTC**, so "today" matches the user's calendar rather than the server's.
- `styles.css` — plain CSS, custom properties, light/dark via `prefers-color-scheme`. No CSS framework, no CSS-in-JS.

### Routing

- Public: `/login`, `/register`, `/join/:token`, and `/s/:token`.
- `/s/:token` (the guest list) sits **outside the `RequireAuth` layout entirely** — it renders its own header and never touches session state. Keep it that way; it must work for someone with no cookie.
- Everything else is nested under `RequireAuth` → `Layout`.

---

## 10. Tests

Two suites, run together with `npm run test:all`.

### Server integration suite — Vitest, `server/test/`

- 75 tests, run with `npm test` from the repo root.
- They are **integration tests over real HTTP**, not unit tests: each file boots the actual app on an ephemeral port and drives it with a cookie-aware client. There is no mocking of the database, the router or the session.
- `test/setup.ts` runs before any application module is imported and points `DATABASE_PATH` at a unique temp file. Vitest gives each test file its own module registry, so **every test file gets its own SQLite database** and files can run in parallel.
- `resetDatabase()` truncates every table in `beforeEach`.
- `createApp({ enableRateLimits: false })` disables the limiter for tests that would otherwise trip it. This is why the share limiter lives in `app.ts` rather than inside `shareRouter`.
- `test/helpers.ts` provides the vocabulary: `registerHousehold()`, `addMember()`, `createSharedList()`, `createClient()` (an independent cookie jar = an independent person).

### What the files cover

- `isolation.test.ts` — **the most important file.** Two households, and every route checked to confirm one cannot see or touch the other's rows.
- `share.test.ts` — guest access: what a guest can do, what the link must never expose, view-only enforcement, revocation, token reuse.
- `auth.test.ts` — registration, login, forged/expired/tampered cookies, and the full invite lifecycle.
- `expenses.test.ts` — cents arithmetic, month-boundary maths, summary aggregation, and what survives a category or member deletion.
- `household.test.ts` — owner vs member permissions, cascade behaviour, list mechanics.
- `recurring.test.ts` — recurrence date maths as a pure function (month-end clamping, leap years, rollovers), then catch-up, idempotency, pause/resume.
- `migrations.test.ts` — fresh builds, repeat runs being no-ops, and the pre-migration-system adoption path.
- `password.test.ts` — self-service change, owner-issued recovery, and that both evict other devices.
- `compression.test.ts` — measures **raw wire bytes** with `node:http`, because `fetch` transparently decompresses and would compare a number with itself.

### Browser smoke test — Playwright, `e2e/`

- 6 tests, run with `npm run test:e2e`. Config is `playwright.config.ts` at the repo root.
- **Covers the guest flow only** — the riskiest path, because it is the one surface reachable without an account. It is a smoke test, not broad UI coverage.
- Playwright's `webServer` runs `npm run build && npm start`, so the tests drive **the production build**: one process serving the API and the built frontend, exactly as a deployment does.
- The run gets a throwaway SQLite file, created in the config and deleted by `e2e/teardown.ts`.
- Chromium: the config uses the sandbox's prebuilt binary when `/opt/pw-browsers/chromium` exists (override with `CHROMIUM_PATH`) and a normally installed browser otherwise. **Never run `playwright install` in the sandbox.**
- Every guest gets `browser.newContext()` — a guest is *defined* by having no cookies and no carried-over storage, so sharing a context would defeat the point.
- Tests create their own household, so they share nothing but the server and can run in parallel.

What it asserts: a member creates and shares a list through the UI; a guest with no account opens the link, names themselves, adds an item and ticks one off; the member sees those changes. Plus view-only enforcement, instant revocation, the name prompt appearing only once, a dead token, and that a guest is bounced off every private route.

**Use `click()`, not `check()`, on the item checkboxes.** They are controlled inputs that only flip once the server round-trip lands, so `check()`'s immediate state assertion fails. Assert the visible outcome instead.

### Both suites were verified by breaking the code

Five deliberate regressions were introduced, and each was caught by a failing test:

1. Removing the `household_id` filter from the expenses list query → `isolation` failed.
2. Adding `householdId` to the guest share response → `share` failed.
3. Removing the view-only check from `editableList()` → `share` failed.
4. Dropping `disabled={!view.canEdit}` from the guest checkbox → the Playwright view-only test failed.
5. Neutering the `RequireAuth` redirect → the Playwright "no way into the rest of the app" test failed.

**Keep it that way.** When you add a test for an invariant, break the code once and confirm it fails. A test that has never failed has not been shown to test anything.

(Worth knowing: regression 5 initially failed to *compile* rather than failing a test, because `noUnusedLocals` caught the orphaned variable. Typecheck is part of the safety net, not separate from it.)

---

## 11. Deployment

- **Target: Fly.io.** One container, one machine, one volume. `DEPLOY.md` has the runbook.
- **Deploys run from GitHub Actions** (`.github/workflows/deploy.yml`, manual trigger), not from a laptop. That is deliberate: it means the whole deployment can be driven from a browser on a tablet or phone, and it keeps `flyctl` out of anyone's local setup. The workflow is idempotent — it creates the app, volume and session secret only when missing, so re-running never destroys data or rotates the secret.
- The `Dockerfile` is a three-stage build: compile with dev dependencies, install production dependencies separately, then copy only `node_modules`, `server/dist` and `web/dist` into a `node:22-slim` runtime. Result is ~36 MB of application layer.
- **Debian, not Alpine**, deliberately: `better-sqlite3` is a native module and the glibc prebuilds mean no compiler in the image.
- The runtime image must keep the source tree's shape — `/app/server/dist` and `/app/web/dist` — because `config.ts` resolves the repo root two levels up from the compiled server directory.
- **Exactly one machine, always.** Every byte of state is in one SQLite file on the volume. A second machine gets its own volume and its own diverging copy, silently. This is the single most damaging mistake available here.
- Sessions are JWTs, so `JWT_SECRET` must stay stable across deploys or everyone is signed out. Production refuses to boot without it.
- Measured sizing: ~85 MB peak RSS, under 6 MB of data after ten years, ~30 MB/month egress → a 256 MB machine and a 1 GB volume, about $2/month.
- The app is safe to let sleep when idle: nothing runs in the background, because recurring expenses materialise on read (§7) and catch up on the next request.

### Backups

- `npm run backup` (`server/src/backup.ts`) uses **SQLite's online backup API**, not a file copy. In WAL mode `cp` can capture the main file without its matching WAL contents — a snapshot that silently lacks recent writes, or is corrupt.
- Verified against a 14,400-expense database: row counts, `integrity_check` and summed totals all match the source.
- Snapshots are timestamped in `/data/backups`, newest `BACKUP_KEEP` (default 14) retained. Pruning removes `-wal`/`-shm` sidecars alongside each snapshot, or they accumulate on the volume forever.
- `.github/workflows/backup.yml` runs it nightly and pulls the result down as an artifact, so a copy exists off the volume. It no-ops until `FLY_API_TOKEN` is set.

---

## 12. Continuous integration

- `.github/workflows/ci.yml` runs on every push and pull request: `npm ci`, typecheck, the server suite, then the Playwright suite.
- Chromium is installed with `npx playwright install --with-deps chromium`. The Playwright config only pins an `executablePath` when the sandbox's prebuilt browser exists, so CI falls through to the normally installed one.
- Runs for the same branch cancel each other, and a failed run uploads the Playwright HTML report as an artifact.

---

## 13. Cross-cutting decisions worth remembering

- **Rate limiting** is per-IP, fixed window, in-process: `/api/auth` 60 req / 15 min, `/api/share` 120 req / min. It is single-instance only — running more than one process needs a shared store.
- `trust proxy` is set to `1`, so `req.ip` is the client IP behind exactly one reverse proxy. Wrong proxy depth = wrong rate-limit keying.
- JSON body limit 256 kb.
- Ids are UUIDv4 from `crypto.randomUUID()`. Share/invite tokens are the longer random-bytes form, since they travel in URLs and are the only thing guarding access.
- Seven default categories are seeded at household creation.
- Invites expire after 14 days and are strictly single-use (`used_at` is set inside the same transaction that creates the user).

---

## 14. Known rough edges

Honest list — these are real, and none is currently blocking.

- **Frontend coverage is the guest flow only.** The expenses dashboard, budgets, invites and household settings have no browser tests — changes there still need checking by hand.
- **Links are generated, not delivered.** Invites and password recovery links are copied by the owner and sent by hand; there is no email integration. This is why recovery is owner-issued rather than self-service "forgot password".
- **The guest list page polls every 15 s; the member list page does not poll at all.** So a member can be looking at a stale list while a guest shops. Unifying this — or moving both to SSE/WebSocket — is the natural fix.
- Rate limiting is in-process and will not survive horizontal scaling (see §13) — moot while the deployment is deliberately one machine.
- **The container runs as root.** Fly volumes mount root-owned, and dropping privileges needs a startup chown dance that was not worth the risk of an unverifiable failure. Worth hardening later.
- `npm audit` flags `react-router` for an **RSC-mode** CSRF issue. This app is a client-side SPA and does not use RSC mode. The only version npm offers as a "fix" is 7.11.0, which reintroduces an open redirect that *does* affect `<Link>`/`useNavigate`. Staying on 7.18.1 is the deliberate, better trade.

---

## 15. Adding a feature — the checklist

1. Does it belong to a household, or is it guest-reachable? That answer decides which router it goes in.
2. Add a **new** migration to `server/src/migrations.ts`. Never edit one that has shipped.
3. Add row types to `server/src/types.ts`.
4. Write the route: `asyncHandler` + Zod via `parseBody` + **`household_id` in the WHERE clause** + `assertOwned` for any client-supplied foreign id.
5. If guests touch it, put the logic in a shared service (like `shoppingItems.ts`) so both paths cannot drift — and re-check what the guest response exposes.
6. **Write the tests.** Anything household-scoped gets a case in `isolation.test.ts`; anything guest-reachable gets one in `share.test.ts` and, if it changes what a guest sees, in `e2e/guest-flow.spec.ts`. Then break the code once and watch them fail (§10).
7. Add the response type to `web/src/api.ts`, then build the page on the `load()` + refetch pattern.
8. Money stays in cents end to end.
9. Update `ARCHITECTURE.md` and `CLAUDE.md` in the same commit.
