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

---

## 3. Data layer

- **SQLite via `better-sqlite3`**, single file at `DATABASE_PATH` (default `data/home-budget.sqlite`).
- **Synchronous driver, on purpose.** All query calls are blocking, which is why most route handlers are plain sync functions. Only bcrypt is async.
- WAL journal mode; `foreign_keys = ON` enforced per connection.
- **Schema is applied on every boot** from the `SCHEMA` constant in `server/src/db.ts`. Every statement is `CREATE ... IF NOT EXISTS`, so it is a no-op on an existing DB.
  - There is **no migration tool and no version table**. Adding a column to an existing deployment currently needs a hand-written `ALTER TABLE`. If the schema starts changing regularly, this is the first thing to replace.
- Backups = copy the `data/` directory. It is gitignored.

### Tables

- `households` — id, name, currency. The top-level tenant.
- `users` — belongs to a household, has `role` of `owner` or `member`. Email is globally unique.
- `invites` — single-use tokens for adding members. Carries `used_at`/`used_by`, `expires_at`, optional pinned `email`.
- `categories` — per household, unique name, colour, optional `monthly_budget_cents`.
- `expenses` — per household. FKs to category and to the paying user.
- `shopping_lists` — per household. Holds the nullable `share_token` and the `share_can_edit` flag.
- `shopping_items` — per list. Records `added_by_name` and `checked_by_name` as **plain text, not FKs** — because a guest with no account may have set them.

### Deletion behaviour (deliberate)

- Delete a household → cascades to everything under it.
- Delete a list → cascades to its items.
- Delete a **member** → their expenses survive; `paid_by` / `created_by` go `NULL`. History is never destroyed by removing a person.
- Delete a **category** → its expenses survive and show as "Uncategorised".

### Money

- **Always integer cents (`amount_cents`, `monthly_budget_cents`). Never floats, never at any layer.**
- Conversion happens at exactly two boundaries: the API accepts major units and does `Math.round(amount * 100)`; the UI divides by 100 only to display via `Intl.NumberFormat`.
- Currency is a household-level setting; it is a display concern only, never converted between currencies.

---

## 4. Authentication

- Passwords: **bcrypt, 12 rounds** (`bcryptjs`, pure JS — no native build step).
- Sessions: **JWT in an httpOnly cookie** named `hb_session`, `SameSite=Lax`, `Secure` in production, 30-day expiry. Not readable from JavaScript; there is no token in `localStorage`.
- The JWT carries only `sub` (user id). **The user row is re-read from the DB on every request**, so role changes and member removal take effect immediately rather than waiting for the token to expire.
- Login returns an identical error for unknown-email and wrong-password, so the endpoint cannot be used to enumerate accounts.
- `NODE_ENV=production` **refuses to boot** without a real `JWT_SECRET`.

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

## 7. Server code map (`server/src/`)

- `app.ts` — `createApp()`: assembles the Express app (routes, static frontend, error middleware last) **without binding a port**, so tests can mount it on an ephemeral one.
- `index.ts` — the entry point. Only calls `createApp().listen(...)`.
- `config.ts` — env parsing, resolves paths relative to repo root, production guardrails.
- `db.ts` — connection + schema.
- `auth.ts` — hashing, cookies, id/token generation, auth middleware.
- `http.ts` — `HttpError` + status helpers, `asyncHandler`, `parseBody`, error middleware.
- `rateLimit.ts` — in-process fixed-window limiter.
- `shoppingItems.ts` — **item operations shared by both the member and guest routes.** Both paths call the same functions with a different `actorName`, so guest and member edits can never diverge in behaviour.
- `routes/` — `auth`, `household`, `categories`, `expenses`, `lists`, `share`.

### Conventions to follow

- Throw `HttpError` (or `badRequest`/`notFound`/`forbidden`/…) from anywhere; the error middleware turns it into JSON. Do not hand-roll `res.status(...).json({error})`.
- Wrap every handler in `asyncHandler` — including sync ones, for uniformity.
- Validate all input with a Zod schema through `parseBody`. `parseBody` is generic over the schema so `.default()` resolves to the *output* type.
- Multi-statement writes go in `db.transaction(...)` (see register and join).

---

## 8. Frontend (`web/src/`)

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

## 9. Tests

- **Vitest, in `server/test/`.** 75 tests, run with `npm test` from the repo root.
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

### These tests were verified by breaking the code

Three deliberate regressions were introduced and each was caught by a failing test:

1. Removing the `household_id` filter from the expenses list query → `isolation` failed.
2. Adding `householdId` to the guest share response → `share` failed.
3. Removing the view-only check from `editableList()` → `share` failed.

**Keep it that way.** When you add a test for an invariant, break the code once and confirm it fails. A test that has never failed has not been shown to test anything.

---

## 10. Cross-cutting decisions worth remembering

- **Rate limiting** is per-IP, fixed window, in-process: `/api/auth` 60 req / 15 min, `/api/share` 120 req / min. It is single-instance only — running more than one process needs a shared store.
- `trust proxy` is set to `1`, so `req.ip` is the client IP behind exactly one reverse proxy. Wrong proxy depth = wrong rate-limit keying.
- JSON body limit 256 kb.
- Ids are UUIDv4 from `crypto.randomUUID()`. Share/invite tokens are the longer random-bytes form, since they travel in URLs and are the only thing guarding access.
- Seven default categories are seeded at household creation.
- Invites expire after 14 days and are strictly single-use (`used_at` is set inside the same transaction that creates the user).

---

## 11. Known rough edges

Honest list — these are real, and none is currently blocking.

- **No frontend tests.** The server suite is solid; React components and pages have no coverage at all. A browser-level smoke test of the guest flow is the obvious next addition.
- **No migration system** (see §3).
- **Invites are generated, not delivered.** The owner copies a link and sends it themselves; there is no email integration.
- **The guest list page polls every 15 s; the member list page does not poll at all.** So a member can be looking at a stale list while a guest shops. Unifying this — or moving both to SSE/WebSocket — is the natural fix.
- `POST /expenses` defaults `paid_by` to the creating user when it is null, but `PUT /expenses/:id` writes whatever it is given, including null. Slightly inconsistent; decide which behaviour is correct before building on it.
- Rate limiting is in-process and will not survive horizontal scaling (see §10).
- `npm audit` flags `react-router` for an **RSC-mode** CSRF issue. This app is a client-side SPA and does not use RSC mode. The only version npm offers as a "fix" is 7.11.0, which reintroduces an open redirect that *does* affect `<Link>`/`useNavigate`. Staying on 7.18.1 is the deliberate, better trade.

---

## 12. Adding a feature — the checklist

1. Does it belong to a household, or is it guest-reachable? That answer decides which router it goes in.
2. Add/extend the table in `db.ts` (`IF NOT EXISTS`) — and hand-write an `ALTER TABLE` if a live DB already exists.
3. Add row types to `server/src/types.ts`.
4. Write the route: `asyncHandler` + Zod via `parseBody` + **`household_id` in the WHERE clause** + `assertOwned` for any client-supplied foreign id.
5. If guests touch it, put the logic in a shared service (like `shoppingItems.ts`) so both paths cannot drift — and re-check what the guest response exposes.
6. **Write the tests.** Anything household-scoped gets a case in `isolation.test.ts`; anything guest-reachable gets one in `share.test.ts`. Then break the code once and watch them fail (§9).
7. Add the response type to `web/src/api.ts`, then build the page on the `load()` + refetch pattern.
8. Money stays in cents end to end.
9. Update `ARCHITECTURE.md` and `CLAUDE.md` in the same commit.
