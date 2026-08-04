# Architecture

Reference for how this app is put together and why. Read this before extending it.

---

## 1. What the app is

- A household finance + shopping web app, with **two deliberately different kinds of access**:
  - **Members** — have accounts, belong to one or more households, share all of each one's data.
  - **Guests** — have *no account*. They reach a single shopping list via a share link and nothing else.
- That two-tier access is the defining constraint of the whole design. Most decisions below exist to serve it.
- **An account and a household are separate things.** Signing up creates an account; a household is
  created or joined afterwards, and one account may hold several. What connects them is a
  `memberships` row, which also carries the name that account goes by *in that household* and what it
  may do there.
- **Exactly one household is "open" at a time**, chosen per session. Every household-scoped query
  still filters on that single id, so the isolation rule in §5 is unchanged — "the caller's
  household" simply means "the one currently open" rather than "the only one they have".

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
- `users` — an **account**: email (globally unique), password hash, `email_verified_at`. Deliberately says nothing about households. `last_household_id` is a convenience only — where a fresh sign-in lands — and is never an access decision.
- `memberships` — one account's place in one household: its `role` (`owner`/`member`) and its `display_name` *there*. Unique on (user, household). This table is what replaced `users.household_id`.
- `email_verifications` — single-use address-confirmation tokens. Cascades with the user.
- `invites` — single-use tokens for adding members. Carries `used_at`/`used_by`, `expires_at`, optional pinned `email`. Redeeming one now adds a membership to an **existing** account rather than creating one.
- `categories` — per household, unique name, colour, optional `monthly_budget_cents`.
- `expenses` — per household. FKs to category and to the paying user.
- `recurring_expenses` — per household. A rule (amount, frequency, start/end) plus `last_generated_on`, the marker that makes generation idempotent.
- `shopping_lists` — per household. Holds the nullable `share_token` and the `share_can_edit` flag.
- `shopping_items` — per list. Records `added_by_name` and `checked_by_name` as **plain text, not FKs** — because a guest with no account may have set them. `note` is the item's comment.
- `password_resets` — single-use recovery tokens. Cascades with the user, so a link cannot resurrect a deleted account.

### Deletion behaviour (deliberate)

- Delete a household → cascades to everything under it.
- Delete a list → cascades to its items.
- Remove a **member** from a household → the membership goes; their **account survives** (it may belong to other households) and so do their expenses. `paid_by` still points at a real user row, so every per-member breakdown asks whether that person is *still here* and folds those who are not into the existing null-payer row — see `PAYER_IF_STILL_HERE` in `routes/expenses.ts`. Without that the split would stop adding up to the total.
- Delete an **account** → `paid_by` / `created_by` go `NULL` via the FKs. History is never destroyed by someone leaving.
- Delete a **category** → its expenses survive and show as "Uncategorised".
- Delete a **recurring rule** → the expenses it already generated survive and lose their `recurring_id`. They record money that really was spent.

### Closing an account or a household

Two routes end things for good: `DELETE /auth/account` (your own account, and
every membership it holds) and `DELETE /household` (owner only, the household
currently open). Both take the caller's password in the body.

- **The password is the confirmation, not a dialog.** A session cookie proves a
  browser signed in once, not who is holding it now — the same reasoning that
  makes `POST /auth/password` ask for the current one. `assertPassword()` in
  `auth.ts` is the shared check.
- **The household delete is one statement.** Every table hangs off `households`
  with `ON DELETE CASCADE`, so there is no delete order to get wrong and no
  orphan to leave behind, and share tokens die with their lists rather than
  needing separate revocation. `DELETE FROM households WHERE id = ?` — the
  `WHERE` is the §5 invariant, not a convenience.
- **Deleting your account is the same deletion the owner could already perform
  from the other side**, so the household's history is untouched: `paid_by`
  goes `NULL` and the money stays counted (above). Leaving must not silently
  rewrite what everybody else's totals say.
- **Handing ownership over.** `PUT /household/members/:id/role` is how a member
  becomes an owner, and it **refuses to change your own role**. That
  single rule is what guarantees an owner always remains: the caller is an
  owner by `requireOwner` and cannot demote themselves, so no counting is
  involved and there is nothing to reason about wrongly. Stepping down means
  asking another owner, the same shape as refusing to remove yourself.
  Demoting a co-owner is allowed because removing them outright already is,
  and this is strictly the gentler of the two.
- **A household must keep an owner.** Deleting an account judges each of its
  households separately, because it may be an owner in one and an ordinary
  member in another. Being the *only* owner of a household with other people in
  it is refused, and that household is named: nobody would be left able to
  invite, rename or remove, and promoting somebody on their behalf is not a
  decision this app should be making. The ways out are handing ownership over
  first — an invite can carry the `owner` role — or deleting that household.
- **The last person out takes the household with them**, since its rows would
  otherwise sit there forever with no account able to reach them.
- **Deleting a household does not sign anybody out.** It is not deleting
  anyone's account, and the others may belong to more households than this one.
  Their memberships are gone, so their next request resolves to no household and
  they land on the picker; the caller's own cookie is re-issued pointing at
  nothing.
- Other members' cookies need no eviction: the user row *and the membership* are
  re-read on every request (§4), so access ends on the next call by construction.
- **Removing a member also retires any recovery link outstanding for them.** This
  used to happen for free — removal deleted the account and `password_resets`
  cascaded. Now the account survives, so without an explicit retirement an owner
  could issue a link, remove the person, and redeem it to take over an account
  that may belong to entirely different households. An owner's reach has to stop
  at their own door.
- There is no undo, no export and no grace period. It is a household budget,
  not a bank.

### Money

- **Always integer cents (`amount_cents`, `monthly_budget_cents`). Never floats, never at any layer.**
- Conversion happens at exactly two boundaries: the API accepts major units and does `Math.round(amount * 100)`; the UI divides by 100 only to display via `Intl.NumberFormat`.
- Currency is a household-level setting; it is a display concern only, never converted between currencies.

---

## 4. Authentication

- Passwords: **bcrypt, 12 rounds** (`bcryptjs`, pure JS — no native build step).
- Sessions: **JWT in an httpOnly cookie** named `hb_session`, `SameSite=Lax`, `Secure` in production, 30-day expiry. Not readable from JavaScript; there is no token in `localStorage`.
- The JWT carries `sub` (user id), `gen` (session generation) and `hh` (the household currently open). **The user row and the membership are re-read from the DB on every request**, so role changes and member removal take effect immediately rather than waiting for the token to expire.
- **`hh` is a claim, never an authorization.** It only counts while a matching membership still exists; being removed from a household, or having it deleted underneath you, drops it on the very next request. With it invalid or absent, an account holding exactly one household falls into that one and anyone with a real choice is left with none open.
- **Switching household re-issues the cookie.** There is still exactly one thing to forge and it is still signed — the choice is never kept anywhere the client can edit.
- Login returns an identical error for unknown-email and wrong-password, so the endpoint cannot be used to enumerate accounts.
- `NODE_ENV=production` **refuses to boot** without a real `JWT_SECRET`.

### Confirming an email address

- Registration mints a single-use link (`email_verifications`, 24 hours, newest-only — the same shape as invites and recovery links). Redeeming it signs the person in, because holding a secret sent to that inbox is the proof.
- **An unconfirmed account can sign in and look around, but cannot create or join a household** (`requireVerifiedEmail`). Blocking sign-in entirely would leave people at a dead end with nothing explaining why; blocking at the household is where an unreachable address stops being only its owner's problem, since a household is what invites and share links hang off.
- Accounts that predate the requirement were backfilled as confirmed. A deploy must not lock out the people already using the app.
- **There is still no email provider** (§14), so the link is returned to the caller and shown on screen by `NoticeCard`, exactly as invites and recovery links already are. `server/src/notifications.ts` is the single seam: when a provider is added, `deliver()` grows a body and no caller changes.

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
- `requireHousehold` — must run after `requireAuth`; refuses a request that is not about any household (403). **This is the guard that kept the multi-household change small**: behind it, `currentUser()` is guaranteed a household id, so all ~80 household-scoped call sites still read `user.householdId` exactly as they did when an account could only ever have one.
- `requireVerifiedEmail` — must run after `requireAuth`; blocks creating or joining a household on an unconfirmed address.
- `currentAccount(req)` — the signed-in account, household fields possibly null.
- `currentUser(req)` — narrows to an account known to be *inside* a household. Throws rather than returning a nullable: a handler reaching it without a household is a routing mistake, not a user error.

---

## 5. Authorization model

- **Owner only**: household settings, create/revoke invites, remove members, **change another member's role**, delete the household.
- **Any member**: categories, expenses, shopping lists, sharing controls, deleting their own account (§3).
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
- The guest response is deliberately narrow: `{ name, canEdit, items }`. No household name, no member names, no ids beyond item ids, no other lists. There is a test that whitelists the keys at both levels, so a field added to an item has to be added to that list deliberately.
- A guest can write an item's comment as well as its name — same routes, same shared service, and only while `share_can_edit` is on.
- **Revocation is instant** — setting `share_token = NULL` makes the old URL 404 on the very next request. No token blocklist needed.
- Re-enabling sharing **reuses the existing token** so links already sent out keep working; only an explicit *Stop sharing* invalidates them.
- `share_can_edit = 0` gives a view-only link: reads pass, all mutations 403.
- **"Copy list" never includes the share link.** The copied text is written to be pasted into group chats, and the token is the one credential this app hands out — putting it in the clipboard alongside the shopping would eventually put it somewhere public. Sending the link stays a separate, deliberate button. There is a test asserting the token is absent from the copied text.
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
- `auth.ts` — hashing, cookies, id/token generation, auth middleware, `setPassword`, `assertPassword`, and the **membership resolution** that turns a cookie's `hh` claim into the household a request is about.
- `notifications.ts` — the one place that decides how a "we would have emailed you" message travels. `deliver()` is the seam a real provider slots into; every caller is ignorant of how a message is sent.
- `http.ts` — `HttpError` + status helpers, `asyncHandler`, `parseBody`, error middleware.
- `rateLimit.ts` — in-process fixed-window limiter.
- `backup.ts` — consistent snapshots via SQLite's online backup API.
- `shoppingItems.ts` — **item operations shared by both the member and guest routes.** Both paths call the same functions with a different `actorName`, so guest and member edits can never diverge in behaviour.
- `routes/` — `auth`, `households`, `household`, `categories`, `expenses`, `recurring`, `lists`, `share`.
  - **`households` (plural) vs `household` (singular)** is a real distinction, not a naming accident. The plural router is the *only* place allowed to talk about a household the caller is not currently in — listing them, creating one, joining by invite, switching. The singular router administers the one that is open and therefore sits behind `requireHousehold`. Mounting order matters: `/api/households` must be registered before `/api/household`, and must not inherit that guard.

### Item comments

An item carries a free-text **comment** (`shopping_items.note` — "the blue box,
not the red one"), settable when it is added and editable afterwards, by a
member or by a guest.

- **A column, not a thread.** One shopping item does not need a conversation; it
  needs the sentence that stops the wrong thing being bought. The column was
  already in the schema, unused by the UI, before this was built — so exposing
  it needed no migration.
- Capped at 500 characters in the Zod schema. Long enough for a sentence or
  two, short enough that the list response stays small.
- **Deliberately not photos.** A photo of the right shelf was the obvious next
  step and was written, then dropped: the bytes have to live somewhere, and
  every option grows a database sized in single-digit MB after ten years (§14)
  and inflates the nightly backup artifact along with it. It is worth doing
  only alongside an answer to storage — object storage off the box, or a
  retention policy — not before.

### The two reporting endpoints

`GET /expenses/summary` and `GET /expenses/stats` look similar and answer
different questions. Keep them apart rather than merging them.

- **`/summary?month=` is one month**: the total, each category against its budget,
  a per-member split and the six-month trend. It is what the dashboard needs.
- **`/stats?from=&to=` is a range of months**: totals, a per-member split, a
  per-category split, the **cross-tab of the two**, and a per-month series
  broken down **both by payer and by category**. It is what the statistics page
  needs. The per-category monthly split is what the category drill-down draws,
  and it ships with the first response rather than behind a second request —
  months x categories is a few hundred small numbers even at the 24-month cap,
  and it makes opening a category instant with no loading state to design.
- Both materialise recurring expenses first (§7), so both are reads that write.
- **Spending with no payer or no category is a row with a `null` id**, not a
  dropped row and not a separate scalar. A removed member's expenses and
  uncategorised spending both still exist (§3), so the per-member and
  per-category breakdowns each add up to the overall total — which is what makes
  the cross-tab trustworthy. The row carries a `null` **name** too: what to call
  it ("Unassigned", "Uncategorised") is a display decision and lives in the UI.
- **Members come back ordered by name, never by spend.** The order decides each
  member's colour on the page, and a colour that moved when the date range
  changed would make every chart lie. There is a test for the ordering.
- The cross-tab sends only the pairs that have spending; the UI fills the rest
  of the grid with zeroes. A household with 6 members and 10 categories would
  otherwise send 60 cells to describe a handful.
- The range is capped at **24 months** (`MAX_STATS_MONTHS`), so one request
  cannot ask for the entire history.
- It needed no migration and no new table: it is a different question asked of
  the rows that were already there.

### Conventions to follow

- Throw `HttpError` (or `badRequest`/`notFound`/`forbidden`/…) from anywhere; the error middleware turns it into JSON. Do not hand-roll `res.status(...).json({error})`.
- Wrap every handler in `asyncHandler` — including sync ones, for uniformity.
- Validate all input with a Zod schema through `parseBody`. `parseBody` is generic over the schema so `.default()` resolves to the *output* type.
- Multi-statement writes go in `db.transaction(...)` (see register and join).

---

## 9. Frontend (`web/src/`)

- React 18, React Router 7, **no state-management library and no data-fetching library**. Deliberate: the app is small and every page's data is scoped to one screen.
- Per-page pattern: `useState` + a `load()` callback + `useEffect`. Mutations call the API then re-run `load()`. **Refetch rather than mutate local state** — it keeps guest/member concurrency honest at the cost of an extra request.
- `api.ts` — thin typed `fetch` wrapper; unwraps `{error}` bodies into `ApiError` carrying the status. Also the single home for all response type definitions. `delete` takes an optional body, which is how the two deletions in §3 send their password confirmation.
- `session.tsx` — the only global state. Holds `user`, the `household` currently open and the full `households` list; hydrates from `GET /auth/me` on mount, treats a 401 as "signed out" rather than an error. `switchHousehold` posts and then **refetches** rather than patching local state: the server decides what the new household contains.
- **Two guards, not one.** `RequireAuth` sends the signed-out to `/login`; `RequireHousehold` sends an account with no household open to `/households`. The second is the client half of the server's `requireHousehold` — without it every page would render and then fill with 403s.
- **`Layout` keys its `<main>` on the household id.** Every page loads its data once on mount, so switching household while already on a page would otherwise leave the previous household's money sitting under the new household's name — the route does not change, so nothing refetches. One key remounts whichever page is on screen, and beats adding a household-changed effect to each of six pages. A browser test covers exactly this.
- `HouseholdSwitcher` is a `<select>` rather than a menu: it is a one-of-n choice and gets the platform's own picker on a phone for free. **It renders even with a single household**, which looks redundant and is not — it first collapsed to plain text on the reasoning that nothing should suggest a choice that does not exist, and that shipped a dead end: `/households` is also where another household is *created*, so anyone with exactly one (everybody, on their first day) had no route to it at all. The chevron is the only affordance saying there is anything beyond the household you are in. A browser test pins the single-household case specifically.
- `NoticeCard` shows a message the app would have emailed, link included. Pretending an inbox will receive something it never will would be worse than saying so.
- `format.ts` — money and date helpers. **Month/day helpers use local time, not UTC**, so "today" matches the user's calendar rather than the server's.
- `styles.css` — plain CSS, custom properties, light/dark themes (§9.1). No CSS framework, no CSS-in-JS.
- `theme.ts` — reads/writes the theme preference and applies it to `<html>`.
- **The two shopping pages share their components, not just their API.**
  `shoppingApi.ts` is the frontend's half of `shoppingItems.ts`: one `ItemApi`
  interface, two implementations (`memberItemApi(listId)` and
  `guestItemApi(token, guestName)`), and `ItemComposer` / `ItemRow` take that
  object rather than a URL. A guest and a member therefore get the same add
  form and the same row, and the pages cannot drift the way two copies would.
  `editable` is what a view-only link turns off; `canDelete` is the one thing
  members have and guests do not.
- **"Copy list" produces plain text, not a screenshot or a link** (`listText.ts`,
  `CopyListButton`). The list goes out to whoever is near the shop through
  WhatsApp or a text message as often as through the share link, and pasted
  text works for someone with no smartphone browser at all. It is on all three
  shopping screens — beside Rename on a list, on every row of the index, and on
  the guest page — because the moment someone wants to send a list on is not
  predictable. A guest gets it too: they can already read every word it
  produces.
- **The index's copy button fetches the list mid-click**, which is why
  `clipboard.ts` exists. `GET /lists` returns counts, not items, so the text is
  not ready when the button is pressed — and Safari only honours a clipboard
  write still attached to the click that began it, which an `await` breaks. The
  fix is to hand the *promise* to `ClipboardItem` so the browser waits inside
  the gesture; `writeText` after an await is the fallback for browsers with no
  `ClipboardItem`, which are also the ones that do not enforce the gesture.
  Loading every list's items into the index instead would have made the common
  case — opening the page — pay for the rare one.
- **A row on the lists index is a `div` wrapping a link, not a link itself.**
  A `<button>` nested inside an `<a>` is invalid, and every press would also
  navigate. `.list-card-link` is the tappable area; the copy button sits beside
  it. There is a test asserting the page has not navigated after a copy.
- **The copied text is deliberately plain ASCII.** A text message written in the
  7-bit GSM alphabet fits 160 characters; a single tick or arrow switches the
  whole message to UCS-2 and halves that to 70. Names and comments may of
  course carry anything, but the app's own scaffolding — `- ` bullets, a
  two-space indent for a comment, `To buy:` / `Already in the basket:` headings
  — adds nothing that costs a segment. The name runs straight into the first
  heading: a blank line there only pushes the shopping further down a phone
  screen, and blank lines earn their place *between* sections. Who added an item and who picked it up
  are left out: useful on screen, noise in a message read in a shop.
- **The comment sits behind a disclosure in the composer**, and is edited from
  the row through `window.prompt` — the same thing renaming a list does. Most
  items are two words and a quantity; a permanent textarea above the list, or
  an inline editor on every row, would be a lot of machinery for a string that
  is usually empty.
- **The two deletions live in a "Danger zone" card at the foot of
  `/household`**, red-bordered and last, so nobody arrives at one by scrolling
  past a form that looked like the ones above it. Each has its own password
  field and its own `window.confirm`, worded with what the household actually
  loses — the confirm counts the other accounts that go with it. `.button
  .danger-solid` is filled rather than the ghost `.button.danger` used for the
  ✕ on a single row: ending an account should not look like the quietest
  control on the page. **The sole owner's "Delete my account" is disabled with
  the reason printed underneath**, since the server refuses it anyway (§3) and
  saying so beats a round trip that only produces an error.
- A row's trailing controls are wrapped in `.item-actions` so that on a phone
  they wrap **as a group**, instead of peeling off one at a time under the
  checkbox.
- **A row that wraps needs a flex *basis*, not just `flex-wrap`.** `.item` is the shared row on six pages, and its rows carry anything from one icon button to an amount plus a text button plus two icons. `.item-main` holds `flex: 1 1 12rem` so that when the text no longer fits beside the buttons the row wraps and gives it a line of its own. At `flex: 1` the basis is 0, which never overflows however little room is left — it just shrinks, and on a phone that put a recurring rule's details in a one-word-per-line column and hid a member's email underneath the "Reset password" button. Same trap as `.card { min-width: 0 }` in §9.2, opposite direction.

### 9.1 Theming

- **One palette, two values each.** Every colour variable is `light-dark(<light>, <dark>)`, resolved against the element's used `color-scheme`. Adding a colour means adding one line, not remembering to edit a second block further down the file.
- **Only two rules in the whole stylesheet mention a theme by name**: `:root[data-theme='light']` and `:root[data-theme='dark']`, each setting nothing but `color-scheme`. Everything else just uses the variables.
- Using `color-scheme` rather than re-listing colours also fixes the native widgets — date pickers, scrollbars, the checkbox tick were all rendering light-on-dark before.
- `light-dark()` takes *colours*, so `--shadow` (a composite value) is built from `--shadow-near` / `--shadow-far` instead.
- **The preference is per-device, not per-user**: `localStorage['home-budget:theme']`, one of `light` / `dark` / `system`. It never touches the API. A guest has no account to hang a setting on, and the same person may want different answers on a phone and a laptop.
- **No `data-theme` attribute at all means "follow the OS"** — that is the `color-scheme: light dark` on `:root`. Do not write `data-theme="system"`.
- **An inline script in `web/index.html` applies the stored choice before first paint.** Without it, a dark-mode device flashes the light palette on every load while React boots. It duplicates `applyTheme()` in `theme.ts` on purpose — the two must be changed together, and there is an e2e test that blocks the JS bundle to prove the inline copy is doing the work.
- `ThemeToggle` sits in both headers: the member `Layout` and `SharedListPage`'s own guest header. Three states, not a switch, because "match device" is the default and a two-way toggle would strand anyone whose phone flips to dark at sunset.
- **The signed-out pages get it too, via `AuthPage`** — the shell every `.auth-page` screen renders through (sign-in, register, join, reset, and the guest page's own error and name-prompt states). They have no header to hold the control, and the sign-in page is where most people land: with no toggle there, the only route to dark mode was to sign in first. The toggle is absolutely positioned in the corner so the card stays centred rather than being pushed down by a second grid row.

### 9.2 Charts and the statistics page

`/stats` is where the household sees who spent what, on which categories, over a
range of months. The charts are plain CSS — divs with widths and heights, no
charting library — and follow a few rules that are easy to undo by accident:

- **Series colours are `--series-1` … `--series-6` in the same `:root` block as
  everything else** (§9.1), one `light-dark()` pair each. They are a
  colour-blind-safe set in a fixed order, checked for separation between
  neighbours and for contrast against both surfaces. **Do not reorder them and
  do not add a seventh by picking a nice colour** — the order is the safety
  mechanism, and a member past the last slot deliberately folds into a grey
  "Other" bucket instead of getting an invented hue.
- **A member's colour comes from their position in the API's name-ordered list**,
  never from their rank. Sorting the display by spend is fine; sorting the
  colour assignment by spend is not.
- Because three of the light-mode series steps sit below 3:1 against white, the
  page always carries **direct labels and the cross-tab table**. Colour is never
  the only way to read a number here — that is what makes the palette legal.
- Stacked segments are separated by a **2px gap showing the card colour**.
  Without it two adjacent segments blend into one band.
- Category bars use the **category's own colour from the database**, not a series
  slot. Categories already have an identity colour; members do not.
- **The cross-tab is one pie per person**, each split by category — a single pie
  cannot show two dimensions, and the question is a two-dimensional one. Slices
  are capped at the household's **top five categories plus a grey "Other"**: a
  pie stops being readable past about six, and the fold is decided once for the
  whole household rather than per person, so a colour means the same thing in
  everybody's pie and the pies can be compared with each other.
- Pies are **all the same size**. Radius encoding an amount would ask people to
  compare areas, which nobody does accurately; each person's total is printed
  under their pie and shown as a bar further up instead.
- **The table did not go away, it went under a `<details>`.** Angles answer
  "roughly who and what"; the numbers answer "exactly how much", and this is an
  app about money. It is also the relief the series palette depends on.
- **A household is seeded with a category literally named "Other"**, so no fold
  bucket may borrow that word. The category fold is "Everything else (n)" and
  the member fold is "Other people". Three meanings of "Other" on one page was
  the bug this replaced.
- **One month is not a trend.** With a single point the drill-down prints the
  figure and says to widen the range, rather than drawing a lone dot between two
  identical axis labels.
- **This page guards its fetches; the others do not need to.** The per-page
  pattern in §9 fetches once per screen, but here four presets and two month
  pickers sit a click apart, so two requests can be in flight at once and the
  older one can answer last. The effect flips a `current` flag in its cleanup
  and a superseded response lands nowhere. Without it the charts can show one
  range while the controls say another — which is exactly what the one-month
  browser test caught.
- **A category row in "Where it went" is a `<button>`** that opens that
  category's month-by-month line. It has to keep looking like the plain row it
  replaced, so `.category-row` strips the border, background, font and padding a
  button brings with it. Using a real button rather than a clickable `<div>` is
  what gives it keyboard focus and `aria-expanded` for free.
- **The drill-down is a line, not more bars.** It answers "how did this move",
  which is a trend, and the page already spends its columns on the stacked
  month-by-month chart. The baseline is zero — money compared against a
  truncated axis exaggerates every wobble. Only the first and last month are
  labelled; a tick per month collides past a handful.
- **Wide children scroll inside their card, never sideways across the page.**
  `.card { min-width: 0 }` is what makes that work: grid and flex items default
  to `min-width: auto`, so before it a 24-column chart or a wide table dragged
  the whole layout past the viewport on a phone.

### Routing

- Public: `/login`, `/register`, `/join/:token`, and `/s/:token`.
- Member pages: `/` (expenses), `/stats`, `/recurring`, `/lists`, `/lists/:id`, `/household`.
- `/s/:token` (the guest list) sits **outside the `RequireAuth` layout entirely** — it renders its own header and never touches session state. Keep it that way; it must work for someone with no cookie.
- Everything else is nested under `RequireAuth` → `Layout`.

---

## 10. Tests

Two suites, run together with `npm run test:all`.

### Server integration suite — Vitest, `server/test/`

- 182 tests, run with `npm test` from the repo root.
- They are **integration tests over real HTTP**, not unit tests: each file boots the actual app on an ephemeral port and drives it with a cookie-aware client. There is no mocking of the database, the router or the session.
- `test/setup.ts` runs before any application module is imported and points `DATABASE_PATH` at a unique temp file. Vitest gives each test file its own module registry, so **every test file gets its own SQLite database** and files can run in parallel.
- `resetDatabase()` truncates every table in `beforeEach`.
- `createApp({ enableRateLimits: false })` disables the limiter for tests that would otherwise trip it. This is why the share limiter lives in `app.ts` rather than inside `shareRouter`.
- `test/helpers.ts` provides the vocabulary: `registerAccount()` (register + confirm), `registerHousehold()` (that, plus a household to own), `createHousehold()` (another one on the same account), `addMember()`, `joinHousehold()`, `createSharedList()`, `createClient()` (an independent cookie jar = an independent person).
- **Run it as `npm test`, never `npx vitest` from the repo root.** The Vitest config lives in `server/`, so a root invocation finds no config, skips `setupFiles`, and every test file silently shares the default database — which looks exactly like a flood of unrelated failures.

### What the files cover

- `isolation.test.ts` — **the most important file.** Two households, and every route checked to confirm one cannot see or touch the other's rows.
- `share.test.ts` — guest access: what a guest can do, what the link must never expose, view-only enforcement, revocation, token reuse.
- `auth.test.ts` — registration, login, forged/expired/tampered cookies, and the full invite lifecycle.
- `accounts.test.ts` — the two-step sign-up and multi-household behaviour: that registering creates an account with no household and no household name is accepted there; that an unconfirmed address cannot create or join one; the confirmation link being single-use, expiring, and retired when a new one is issued; one account owning several households with their data provably apart and their categories seeded separately; a different display name in each; switching, and refusing to switch into one you are not in; where a returning sign-in lands.
- `itemComments.test.ts` — the comment on a shopping item: set on add, edited, cleared, and the length cap.
- `expenses.test.ts` — cents arithmetic, month-boundary maths, summary aggregation, and what survives a category or member deletion. Also the statistics endpoint: the per-member and per-category splits, the member/category cross-tab adding up to the same money as the totals, months with no spending, the name ordering that pins each member's colour, and the range validation.
- `household.test.ts` — owner vs member permissions, list mechanics, and the two irreversible deletions (§3): the cascade taking the memberships and share links but **leaving the accounts standing**, the password confirmation, the refusal of a sole owner with company, the last owner taking the household with them, and a member leaving without moving anybody's totals.
- `recurring.test.ts` — recurrence date maths as a pure function (month-end clamping, leap years, rollovers), then catch-up, idempotency, pause/resume.
- `migrations.test.ts` — fresh builds, repeat runs being no-ops, and the pre-migration-system adoption path.
- `password.test.ts` — self-service change, owner-issued recovery, and that both evict other devices.
- `compression.test.ts` — measures **raw wire bytes** with `node:http`, because `fetch` transparently decompresses and would compare a number with itself.

### Browser tests — Playwright, `e2e/`

- 18 tests, run with `npm run test:e2e`. Config is `playwright.config.ts` at the repo root.
- **Three areas: the guest flow, the statistics page and multiple households.** The guest flow is the riskiest path — the one surface reachable without an account — and was the only coverage for a long time. (The theme test lives there because the toggle is on the guest header too.)
- `statistics.spec.ts` exists because **every bug that page has had was invisible to the server suite**: a fold bucket that borrowed a real category's name, a one-month range drawing a lone dot, a stale response overwriting a newer one. Those are questions about what is on the screen. It reaches the page through the header link, never a direct URL — a page nobody can navigate to is a page nobody has.
- `seedStatsHousehold()` builds a household through the API, giving **each joining member its own request context**: joining sets a session cookie, and a shared jar would sign the owner out halfway through.
- **The e2e server runs with `RATE_LIMITS=off`.** An eight-person household signs in and out far more often inside one 15-minute window than a real visitor would, and the auth limiter is right to refuse that. `config.ts` ignores the variable when `NODE_ENV=production`, so it cannot un-protect the live site.
- Playwright's `webServer` runs `npm run build && npm start`, so the tests drive **the production build**: one process serving the API and the built frontend, exactly as a deployment does.
- The run gets a throwaway SQLite file, created in the config and deleted by `e2e/teardown.ts`.
- Chromium: the config uses the sandbox's prebuilt binary when `/opt/pw-browsers/chromium` exists (override with `CHROMIUM_PATH`) and a normally installed browser otherwise. **Never run `playwright install` in the sandbox.**
- Every guest gets `browser.newContext()` — a guest is *defined* by having no cookies and no carried-over storage, so sharing a context would defeat the point.
- Tests create their own household, so they share nothing but the server and can run in parallel.
- `households.spec.ts` asks the questions only a browser can: that the switcher exists as a real control, that using it actually repaints the page (it did not, at first — see the `<main>` key in §9), that the choice survives a reload, that a single-household account can still reach `/households` (it could not, at first), and what a brand new account is shown before it has a household at all.

What it asserts: a member creates and shares a list through the UI; a guest with no account opens the link, names themselves, adds an item and ticks one off; the member sees those changes. A second journey covers the comment: a guest adds an item carrying one, the household reads it and rewrites it, and the guest sees the new wording. A third covers "Copy list" on all three screens it appears on: the clipboard is read back and compared to the exact expected text, and asserted not to contain the share token. The index case also asserts the page did not navigate, since that button lives inside a row that is otherwise a link. Plus view-only enforcement — including that a view-only guest can read a comment but is offered no control to change it — instant revocation, the name prompt appearing only once, a dead token, that a guest is bounced off every private route, that a chosen theme survives a reload without a flash, and that the sign-in page carries the toggle at all — the one signed-out screen everybody sees.

**Use `click()`, not `check()`, on the item checkboxes.** They are controlled inputs that only flip once the server round-trip lands, so `check()`'s immediate state assertion fails. Assert the visible outcome instead.

### Both suites were verified by breaking the code

Twenty-four deliberate regressions were introduced, and each was caught by a failing test:

1. Removing the `household_id` filter from the expenses list query → `isolation` failed.
2. Adding `householdId` to the guest share response → `share` failed.
3. Removing the view-only check from `editableList()` → `share` failed.
4. Dropping `disabled={!view.canEdit}` from the guest checkbox → the Playwright view-only test failed.
5. Neutering the `RequireAuth` redirect → the Playwright "no way into the rest of the app" test failed.
6. Deleting the pre-paint theme script from `index.html` → the Playwright theme test failed on the JS-blocked reload (React alone cannot satisfy it).
7. Removing `:root[data-theme='dark'] { color-scheme: dark }` → the same test failed, because picking Dark then changed no colour.
8. Taking `ThemeToggle` back out of `AuthPage` → the sign-in-page test failed, with no control to click.
9. Putting the category fold bucket back on the word "Other" → the statistics fold test failed.
10. Removing the Statistics link from the header → all four statistics tests failed, since none of them types a URL.
11. Dropping `note` from the item update statement → `itemComments` failed, an edit silently doing nothing.
12. Rendering `ItemRow`'s comment button regardless of `editable` → the Playwright view-only test failed, with an edit control on a read-only link.
13. Dropping the comment from `listAsText` → the copy test failed on the exact text.
14. Appending the current URL to the copied text → the copy test failed on the token assertion, which is the whole point of that line.
15. Dropping `requireOwner` from `DELETE /household` → `household` failed, a member able to close the family's household down.
16. Skipping `assertPassword` in `DELETE /auth/account` → `household` failed, a borrowed browser enough to delete the account.
17. Neutering the "anyone else still here" half of the sole-owner guard → `household` failed, the last owner walking out of a household full of people.
18. Making a member's own deletion drop the household rather than the user → `household` failed, one person leaving taking everyone's money with them.
19. Removing `WHERE id = ?` from the household delete → `isolation` failed, one family's departure emptying every other family's tables.
20. Making the session trust the cookie's `hh` without checking the membership still exists → `household` and `accounts` failed, someone removed from a household keeping their access to it.
21. Dropping `requireVerifiedEmail` from household creation → `accounts` failed, an unconfirmed address able to create and invite.
22. Reducing `PAYER_IF_STILL_HERE` to a plain `e.paid_by` → `expenses` failed on both the removed-payer case and the cross-tab totals, the per-member split quietly ceasing to add up.
23. Removing the recovery-link retirement from member removal → `password` failed, an owner able to mint a link, remove the person, and take over an account that may belong to other households.
24. Listing memberships without filtering by account → `isolation` failed, one account seeing another's households.

The statistics suite also earned its place on the way in: the one-month test failed against the unguarded fetch, which is how the stale-response race in §9.2 was found.

**Keep it that way.** When you add a test for an invariant, break the code once and confirm it fails. A test that has never failed has not been shown to test anything.

(Worth knowing: regression 5 initially failed to *compile* rather than failing a test, because `noUnusedLocals` caught the orphaned variable. Typecheck is part of the safety net, not separate from it.)

### Which routes the suites reach

`node .claude/skills/route-coverage/audit.mjs` reads the routers, resolves their mount prefixes from `app.ts`, and reports two things: routes **no test file calls at all**, marking those that take a client-supplied id (what rule 1 and `assertOwned()` are about), and routes exercised somewhere other than the file §15 names. The second list is usually fine — `recurring.test.ts` holds its own cross-household case rather than putting it in `isolation.test.ts`. `--strict` fails on the first list only.

As of this commit the first list is empty: the two that were on it — `DELETE /api/lists/:id/items/:itemId` and `POST /api/lists/:id/items/clear-checked` — now have cases in `isolation.test.ts`.

It matches on method and path shape, so it proves a suite *reaches* a route and nothing more; a case that asserts nothing counts as reached. Uncalled does not mean broken either — everything it has flagged so far was correctly filtered code. Treat it as the checklist for §15 step 6, not as evidence.

### Looking at the pages the suites do not cover

Everything in `web/` outside the guest flow, the sign-in toggle and the statistics page is unproven by any test, so a change there has to be looked at. `.claude/skills/preview-ui/` is the tool for that: it builds, runs the production build on a spare port against a throwaway database, seeds a three-person household with three months of expenses **plus a second household on the owner's account** (so the header's switcher has something to switch between — with one it deliberately renders as plain text), signs in, and screenshots the routes you name in both themes at 1100px and 390px.

```bash
node .claude/skills/preview-ui/preview.mjs /            # the expenses dashboard
node .claude/skills/preview-ui/preview.mjs /stats /lists/:id /s/:token --skip-build
```

Alongside each screenshot it reports the body colour — the cheap proof a theme applied (§9.1) — whether the header links to the page at all, and any console errors. Share links are opened in a context with no cookie, because a guest is defined by having none (§6).

**It is for looking, not for proving.** A screenshot confirms today's change; only a test stops it regressing. When what you checked is an invariant rather than an appearance, write the test as well — and break the code once to watch it fail.

---

## 11. Deployment

- **Target: AWS Lightsail** — one small VPS running two containers via Docker Compose: the app, and **Caddy** in front terminating TLS. `DEPLOY.md` is the runbook.
- **Caddy is not decoration.** The app marks session cookies `Secure` in production, so plain HTTP would break sign-in outright. Caddy obtains and renews a Let's Encrypt certificate automatically, which is why a real domain is required rather than a bare IP.
- The app still trusts exactly one proxy hop (`trust proxy = 1`), which is Caddy. Change that if another proxy is ever added, or per-IP rate limiting will key on the wrong address.
- **DNS is Cloudflare, but unproxied — DNS only, grey cloud.** That is what keeps the previous bullet true: a proxied record puts Cloudflare's edge in front of Caddy, making two hops, and per-IP limits would then bucket every visitor behind a handful of edge addresses. It also lets Caddy keep answering the ACME challenge itself. Turning the proxy on means fixing the hop count and moving certificates to Cloudflare — not a toggle.
- **The image is built in CI, never on the server.** A Vite build on a small instance is a real risk of running out of memory. GitHub Actions builds it, pushes to GHCR, and the server only pulls. Registry credentials are a short-lived token passed at deploy time, so nothing long-lived sits on the box.
- **Everything runs from the Actions tab** — deploy, backup and restore — because the person maintaining this may only have a tablet. Lightsail's browser SSH covers the rest.
- `deploy/bootstrap.sh` runs once on a fresh instance: installs Docker, creates `/opt/home-budget`, generates `JWT_SECRET`. It deliberately never regenerates an existing secret, since that would sign everyone out.
- `APP_IMAGE` in the server's `.env` records the deployed tag. Rolling back is editing it to an earlier SHA and running `docker compose up -d`.
- Measured sizing: ~85 MB peak RSS, under 6 MB of data after ten years, ~30 MB/month egress. The $5/month bundle includes 1 TB of transfer.
- **Fly.io was the original target** and the Dockerfile came from that work. It was abandoned for an account-level reason, not a technical one: Fly refuses API tokens to accounts belonging to an SSO-requiring organization, and fails silently in the UI. Without a token there is no CI deploy. Nothing in the app had to change to move.

### Backups

- `npm run backup` (`server/src/backup.ts`) uses **SQLite's online backup API**, not a file copy. In WAL mode `cp` can capture the main file without its matching WAL contents — a snapshot silently lacking recent writes, or corrupt.
- Verified against a 14,400-expense database: row counts, `integrity_check` and summed totals all match the source.
- Snapshots are timestamped in `data/backups/`, newest `BACKUP_KEEP` (default 14) retained. Pruning removes `-wal`/`-shm` sidecars alongside each snapshot, or they accumulate forever.
- `.github/workflows/backup.yml` runs nightly, **verifies the snapshot with `integrity_check` before accepting it**, and uploads it as an artifact — a copy off the server's disk.
- `.github/workflows/restore.yml` puts one back: it re-verifies the file, stops the app, keeps the current database as `home-budget.replaced-<timestamp>.sqlite`, swaps and restarts. Deliberately manual and gated on typing `CONFIRM`.
- **Restore removes the old WAL sidecars.** Leaving them next to a restored database would corrupt it — they belong to the file that was replaced.

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

- **Frontend coverage is the guest flow, the statistics page and the household switcher.** The expenses dashboard, budgets, recurring, invites and household settings have no browser tests — changes there still need checking by hand, against the built app rather than by reading the CSS.
- **There is no way to leave a household without deleting your account.** An
  owner can remove anyone but themselves, so a member who simply wants out has
  to ask. `DELETE /household/members/me` is the missing route.
- **Nothing is ever emailed. This is the current blocker** — `TODO.md` carries the working brief, including what only a human can do (provider account, DNS, API key). **Links are generated, not delivered — including email confirmation.** Invites, password recovery and now address confirmation are all shown on screen rather than sent; there is no email provider. This is why recovery is owner-issued rather than self-service "forgot password", and it means **confirmation currently proves nothing about the address** — whoever registered is handed the link immediately, so it is a step in the flow rather than a real check. It becomes a real one the moment `deliver()` in `notifications.ts` learns to send, and nothing else has to change. Until then, do not describe it as verification anywhere user-facing.
- **An owner-issued recovery link grants the whole account, which may span households.** Removing someone now retires their outstanding links (§3), which closes the obvious abuse, but an owner can still reset the password of an account that belongs to other households while that person is a member. That was contained when an account *was* a household; it is not any more. A self-service "forgot password" would remove the need for the feature altogether.
- **The guest list page polls every 15 s; the member list page does not poll at all.** So a member can be looking at a stale list while a guest shops. Unifying this — or moving both to SSE/WebSocket — is the natural fix.
- Rate limiting is in-process and will not survive horizontal scaling (see §13) — moot while the deployment is deliberately one machine.
- **The container runs as root.** Fly volumes mount root-owned, and dropping privileges needs a startup chown dance that was not worth the risk of an unverifiable failure. Worth hardening later.
- `npm audit` flags `react-router` for an **RSC-mode** CSRF issue. This app is a client-side SPA and does not use RSC mode. The only version npm offers as a "fix" is 7.11.0, which reintroduces an open redirect that *does* affect `<Link>`/`useNavigate`. Staying on 7.18.1 is the deliberate, better trade.

---

## 15. Adding a feature — the checklist

1. Does it belong to a household, is it about the **account** across households, or is it guest-reachable? That answer decides which router it goes in — and whether it sits behind `requireHousehold` (§4).
2. Add a **new** migration to `server/src/migrations.ts`. Never edit one that has shipped.
3. Add row types to `server/src/types.ts`.
4. Write the route: `asyncHandler` + Zod via `parseBody` + **`household_id` in the WHERE clause** + `assertOwned` for any client-supplied foreign id. "Is this person one of ours" is a `memberships` question, not a `users` one.
5. If guests touch it, put the logic in a shared service (like `shoppingItems.ts`) so both paths cannot drift — and re-check what the guest response exposes.
6. **Write the tests.** Anything household-scoped gets a case in `isolation.test.ts`; anything guest-reachable gets one in `share.test.ts` and, if it changes what a guest sees, in `e2e/guest-flow.spec.ts`. Then break the code once and watch them fail (§10).
7. Add the response type to `web/src/api.ts`, then build the page on the `load()` + refetch pattern. It will remount when the household changes (§9), so it needs no household-changed effect of its own.
8. Money stays in cents end to end.
9. Update `ARCHITECTURE.md` and `CLAUDE.md` in the same commit.
