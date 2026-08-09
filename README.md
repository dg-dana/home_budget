# Home Budget

A web application for tracking domestic expenses and running shared shopping lists.

Two kinds of people use it:

- **Family members** have accounts. An account belongs to one or more households
  and shares each one's expenses, budgets, categories and shopping lists, under a
  name it chooses per household.
- **Guests** have no account at all. They open a shopping list through a share link
  and can tick items off or add to it. They never see expenses, budgets, members,
  or any other list.

## Features

**Expenses**
- Add, edit and delete expenses with an amount, date, description, category and who paid
- Month-by-month view with total spent, biggest category and daily average
- Monthly budget per category, with a progress bar and an over-budget warning
- Breakdown by category and by household member, plus a six-month trend
- A **statistics page** over any range: who spent what, on what, and how a single
  category moved month by month
- Currency is a household setting (amounts are stored as integer cents, never floats)

**Recurring expenses**
- Rent, bills and subscriptions repeat weekly, monthly or yearly
- Optional end date; pause and resume without losing the rule
- Occurrences are created automatically when due, and caught up if the app was
  not opened for a while — resuming a paused rule skips the gap rather than
  back-charging it
- Generated expenses are marked as repeating but are otherwise ordinary, so they
  count towards budgets and totals

**Shopping lists**
- Any number of lists per household, each with items, quantities and notes
- Tick items off; the list records who added each item and who picked it up
- Open pages refresh themselves every 15 seconds, so somebody at home and
  somebody in the shop see the same list without either of them reloading
- "Clear bought" empties the basket and leaves what is still outstanding
- Share any list by link — see below

**Household**
- Single-use invite links to add family members (expire after 14 days, revocable).
  An address already in the household cannot be invited, and following an invite
  to a household you are already in offers to open it rather than asking you to
  join twice
- Change your own password; changing it signs out every other device
- **Forgotten your password?** on the sign-in page emails a single-use recovery
  link. It says the same thing whether or not the address has an account, so it
  cannot be used to find out who does
- Where no email provider is configured, an owner can issue that link instead —
  the fallback, and the *only* place that power still exists. A recovery link
  grants a whole account, which may belong to households the owner has never
  heard of, so it is refused anywhere people can help themselves
- Owner can rename the household, change currency, manage categories, remove members
  and promote another member to owner
- Members can record expenses and use lists; only the owner manages the household itself
- Anyone can **leave a household** without deleting their account, and close their
  account from the households picker

**Everything else**
- **English or German**, switched from a picker on every screen — including the
  sign-in page and the guest share link, so it needs no account. Choosing German
  moves the money and the dates too, not only the words
- **Light and dark**, following the device unless told otherwise — the toggle is on
  every screen including the sign-in page
- **Both settings belong to your account**, so signing in on a new phone, or on a
  browser that has forgotten everything, brings them back. Signed out, and for a
  guest, they live on the device — which is the only place they can
- **Email** for anything needing a link, and for what has already happened: joins,
  removals, role changes, renames, deletions, password changes. Routine edits send
  nothing, deliberately — a household that emails on every grocery item trains
  everyone to ignore it. Optional; see Configuration
- **Emails are written per recipient**, so one household with an English member
  and a German one gets two versions of the same message

## Sharing a list with someone outside the family

Open a list → **Create share link**. That produces a URL like `/s/<token>` which works
with no account and no sign-in. The person is asked once for a display name so the
household can see who picked up what.

Two controls sit with the list owner:

- **Let guests add items and tick things off** — turn off for a view-only link
- **Stop sharing** — revokes the token, and the old link stops working immediately

A share link only ever exposes that one list's name and items. Expenses, budgets,
household members and other lists are unreachable through it.

## Stack

| Layer    | Choice                                          |
| -------- | ----------------------------------------------- |
| Frontend | React 18, TypeScript, Vite, React Router         |
| Backend  | Node, Express, TypeScript                        |
| Database | SQLite via better-sqlite3 (single file, WAL)     |
| Auth     | bcrypt password hashes, JWT in an httpOnly cookie |

Responses are gzipped, which takes a month of expenses from 47 kB to 4 kB.

The repo is an npm workspace with two packages: `server/` and `web/`.

## Running it

```bash
npm install
cp .env.example .env      # then edit JWT_SECRET
npm run dev
```

`npm run dev` starts the API on port 4000 and the Vite dev server on port 5173.
Open http://localhost:5173 — Vite proxies `/api` to the backend so cookies stay
same-origin. Sign up, confirm the address, then create a household from the picker
to get started; seven default categories are created with it.

### Tests

```bash
npm test          # server integration suite (255 tests, Vitest)
npm run test:e2e  # browser tests (35 tests, Playwright)
npm run test:all  # both
```

The server suite runs the real app over HTTP against a real SQLite database — no
mocks — covering cross-household isolation, guest share access, authentication,
invites and email confirmation, both kinds of password recovery, what the app emails
and to whom, expense arithmetic and statistics, recurrence dates and migrations, and
owner/member permissions. Nothing in it ever reaches a mail provider: the two files
about email stub `fetch`.

The Playwright suite builds the app and drives the production build in a browser,
covering the guest flow end to end (sharing a list, a guest with no account adding
and ticking off items, comments, "Copy list", view-only enforcement, instant
revocation, theming, and a member's open page catching up with a guest on its
own), the statistics page, and the household switcher. The rest of
the frontend has no browser coverage — see `ARCHITECTURE.md` §10, and
`.claude/skills/preview-ui` for looking at a page instead.

Every push runs typecheck and both suites in GitHub Actions
(`.github/workflows/ci.yml`).

### Production

```bash
npm run build
NODE_ENV=production JWT_SECRET=<long random value> npm start
```

To deploy to AWS Lightsail, see **[DEPLOY.md](DEPLOY.md)** — one small VPS with
Docker Compose and automatic HTTPS, $5/month plus a domain. It also covers
backups and restores, which matter more than the hosting choice.

The build compiles the server to `server/dist` and the frontend to `web/dist`. In
production the Express process serves the built frontend itself, so the whole app runs
on a single port with no separate web server. `NODE_ENV=production` also refuses to
boot without a real `JWT_SECRET` and marks the session cookie `Secure` — put it behind
HTTPS.

### Configuration

All optional except `JWT_SECRET` in production. See `.env.example`.

| Variable        | Default                   | Meaning                            |
| --------------- | ------------------------- | ---------------------------------- |
| `PORT`          | `4000`                    | Port the API listens on            |
| `JWT_SECRET`    | dev-only fallback         | Signs session cookies              |
| `DATABASE_PATH` | `data/home-budget.sqlite` | SQLite file, relative to repo root |
| `NODE_ENV`      | `development`             | Set to `production` when deploying |
| `RESEND_API_KEY`| unset                     | Turns email sending on              |
| `DOMAIN`        | unset                     | `MAIL_FROM` and `APP_URL` derive from it |
| `MAIL_FROM`     | `Home Budget <noreply@$DOMAIN>` | Override the from address     |
| `APP_URL`       | `https://$DOMAIN`         | Makes the links in emails absolute  |

**With no `RESEND_API_KEY` nothing is emailed, and that is a supported state** —
confirmation, invite and recovery links come back in the response and are shown on
screen to whoever asked, which is how the app works out of the box and how the test
suite runs. The one thing that needs a provider is **"Forgotten your password?"**: it
is unauthenticated, so it refuses rather than showing a link (see Security notes).

The database file is created on first boot and any pending migrations are applied
automatically on every start, so there is no separate migration step to run. `data/`
is gitignored — back that directory up and you have backed up everything.

## API

Everything is under `/api`. Routes below `/api/share` are deliberately unauthenticated;
everything else requires the session cookie. **account** means any signed-in account,
**member** and **owner** additionally require a household to be open — the one the
session currently names.

| Method | Path                              | Who            |
| ------ | --------------------------------- | -------------- |
| POST   | `/auth/register`                  | anyone         |
| POST   | `/auth/login`, `/auth/logout`     | anyone         |
| GET    | `/auth/verify/:token`, `POST /auth/verify` | anyone |
| POST   | `/auth/verify/resend`             | account        |
| GET    | `/auth/invite/:token`             | anyone         |
| GET    | `/auth/me`                        | account        |
| POST   | `/auth/password`                  | account        |
| PUT    | `/auth/preferences`               | account        |
| POST   | `/auth/forgot`                    | anyone         |
| GET    | `/auth/reset/:token`              | anyone         |
| POST   | `/auth/reset`                     | anyone         |
| DELETE | `/auth/account`                   | account        |
| GET    | `/households`                     | account        |
| POST   | `/households`                     | account        |
| GET    | `/households/invitations`         | account        |
| POST   | `/households/join`                | account        |
| POST   | `/households/:id/switch`          | account        |
| GET    | `/household`, `/household/members`| member         |
| PUT    | `/household/me`                   | member         |
| DELETE | `/household/members/me`           | member         |
| PUT    | `/household`                      | owner          |
| DELETE | `/household`                      | owner          |
| GET    | `/household/invites`              | owner          |
| POST   | `/household/invites`              | owner          |
| DELETE | `/household/invites/:token`       | owner          |
| DELETE | `/household/members/:id`          | owner          |
| PUT    | `/household/members/:id/role`     | owner          |
| POST   | `/household/members/:id/reset-password` | owner, and only where email is unconfigured |
| CRUD   | `/categories`                     | member         |
| CRUD   | `/expenses`                       | member         |
| GET    | `/expenses/summary?month=YYYY-MM` | member         |
| GET    | `/expenses/stats`                 | member         |
| CRUD   | `/recurring`                      | member         |
| POST   | `/recurring/:id/active`           | member         |
| CRUD   | `/lists`, `/lists/:id/items`      | member         |
| POST   | `/lists/:id/items/clear-checked`  | member         |
| POST   | `/lists/:id/share`                | member         |
| DELETE | `/lists/:id/share`                | member         |
| GET    | `/share/:token`                   | **guest**      |
| POST   | `/share/:token/items`             | **guest**      |
| PATCH  | `/share/:token/items/:itemId`     | **guest**      |
| DELETE | `/share/:token/items/:itemId`     | **guest**      |
| POST   | `/share/:token/clear-checked`     | **guest**      |

Every household-scoped query filters on the caller's `household_id`, so an id from one
household cannot be used to read or change another's data.

## Security notes

- Passwords are bcrypt-hashed at 12 rounds; login returns the same error for an unknown
  email and a wrong password, and `POST /auth/forgot` answers identically whether or not
  the address has an account — neither can be used to enumerate who has one
- Sessions are JWTs in an httpOnly, SameSite=Lax cookie — not readable from JavaScript
- Invite, share and recovery tokens are 24 random bytes from `crypto.randomBytes`
- A recovery link is only ever emailed, never returned to whoever asked for it. Where no
  email provider is configured the route refuses outright rather than showing the link,
  since an unauthenticated page printing one would open every account to anybody who
  knows its address
- Sign-in and the guest share endpoints are rate limited per IP; asking for a recovery
  link is limited per **address** as well, because each request mails somebody who did
  not ask
- Changing a password invalidates that account's other sessions immediately
- Guest mutations are rejected as soon as the owner switches a list to view-only or
  revokes the link

`npm audit` reports one advisory against `react-router` (RSC-mode CSRF, GHSA-qwww-vcr4-c8h2).
It affects React Router's server-side RSC mode; this app is a client-side SPA that does
not use it. The only version npm offers as a "fix" is 7.11.0, which reintroduces an open
redirect that *does* affect `<Link>`/`useNavigate`, so the app stays on 7.18.1.

## Project layout

```
server/src
  app.ts            Express app assembly — routes, limiters, static frontend
  index.ts          The entry point; binds the port and nothing else
  config.ts         Environment configuration
  db.ts             SQLite connection and migration runner
  migrations.ts     Ordered, append-only schema migrations
  recurring.ts      Recurrence date maths and materialisation
  auth.ts           Password hashing, session cookies, auth middleware, membership
                    resolution, recovery links
  notifications.ts  The one place that decides how a message travels
  http.ts           HttpError, async wrapper, Zod body parsing, error middleware
  rateLimit.ts      In-process fixed-window limiter, keyed by IP or by anything
  backup.ts         Consistent snapshots via SQLite's online backup API
  shoppingItems.ts  Item operations shared by the member and guest routes
  routes/           auth, households, household, categories, expenses, recurring,
                    lists, share

web/src
  api.ts            Typed fetch wrapper and response shapes
  session.tsx       Session context — the account, its households, the one open
  theme.ts          Theme preference, applied to <html>
  format.ts         Money and date formatting
  listText.ts       A list as plain text, for the clipboard
  shoppingApi.ts    One item interface, implemented for members and for guests
  components/       Layout, AuthPage, HouseholdSwitcher, ThemeToggle, NoticeCard,
                    ItemComposer, ItemRow, CopyListButton
  pages/            Login, Register, ForgotPassword, ResetPassword, VerifyEmail,
                    Households, Join, Expenses, Stats, Recurring, Lists,
                    ListDetail, Household, SharedList (the guest view)
```
