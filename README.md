# Home Budget

A web application for tracking domestic expenses and running shared shopping lists.

Two kinds of people use it:

- **Family members** have accounts and belong to a household. They share expenses,
  budgets, categories and shopping lists.
- **Guests** have no account at all. They open a shopping list through a share link
  and can tick items off or add to it. They never see expenses, budgets, members,
  or any other list.

## Features

**Expenses**
- Add, edit and delete expenses with an amount, date, description, category and who paid
- Month-by-month view with total spent, biggest category and daily average
- Monthly budget per category, with a progress bar and an over-budget warning
- Breakdown by category and by household member, plus a six-month trend
- Currency is a household setting (amounts are stored as integer cents, never floats)

**Shopping lists**
- Any number of lists per household, each with items, quantities and notes
- Tick items off; the list records who added each item and who picked it up
- "Clear bought" empties the basket and leaves what is still outstanding
- Share any list by link — see below

**Household**
- Single-use invite links to add family members (expire after 14 days, revocable)
- Owner can rename the household, change currency, manage categories and remove members
- Members can record expenses and use lists; only the owner manages the household itself

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

The repo is an npm workspace with two packages: `server/` and `web/`.

## Running it

```bash
npm install
cp .env.example .env      # then edit JWT_SECRET
npm run dev
```

`npm run dev` starts the API on port 4000 and the Vite dev server on port 5173.
Open http://localhost:5173 — Vite proxies `/api` to the backend so cookies stay
same-origin. Create a household from the sign-up page to get started; seven default
categories are created with it.

### Tests

```bash
npm test          # server integration suite (75 tests, Vitest)
npm run test:e2e  # guest-flow browser smoke test (6 tests, Playwright)
npm run test:all  # both
```

The server suite runs the real app over HTTP against a real SQLite database — no
mocks — covering cross-household isolation, guest share access, authentication and
invites, expense arithmetic, and owner/member permissions.

The Playwright suite builds the app and drives the production build in a browser,
covering the guest flow end to end: sharing a list, a guest with no account adding
and ticking off items, view-only enforcement, and instant revocation. Other parts
of the frontend have no browser coverage yet. See `ARCHITECTURE.md` §9.

### Production

```bash
npm run build
NODE_ENV=production JWT_SECRET=<long random value> npm start
```

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

The database file is created on first boot and the schema is applied idempotently on
every start, so there is no separate migration step. `data/` is gitignored — back that
directory up and you have backed up everything.

## API

Everything is under `/api`. Routes below `/api/share` are deliberately unauthenticated;
everything else requires the session cookie.

| Method | Path                              | Who            |
| ------ | --------------------------------- | -------------- |
| POST   | `/auth/register`                  | anyone         |
| POST   | `/auth/login`, `/auth/logout`     | anyone         |
| GET    | `/auth/invite/:token`             | anyone         |
| POST   | `/auth/join`                      | anyone         |
| GET    | `/auth/me`                        | member         |
| GET    | `/household`, `/household/members`| member         |
| PUT    | `/household`                      | owner          |
| GET    | `/household/invites`              | owner          |
| POST   | `/household/invites`              | owner          |
| DELETE | `/household/invites/:token`       | owner          |
| DELETE | `/household/members/:id`          | owner          |
| CRUD   | `/categories`                     | member         |
| CRUD   | `/expenses`                       | member         |
| GET    | `/expenses/summary?month=YYYY-MM` | member         |
| CRUD   | `/lists`, `/lists/:id/items`      | member         |
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
  email and a wrong password
- Sessions are JWTs in an httpOnly, SameSite=Lax cookie — not readable from JavaScript
- Invite and share tokens are 24 random bytes from `crypto.randomBytes`
- Sign-in and the guest share endpoints are rate limited per IP
- Guest mutations are rejected as soon as the owner switches a list to view-only or
  revokes the link

`npm audit` reports one advisory against `react-router` (RSC-mode CSRF, GHSA-qwww-vcr4-c8h2).
It affects React Router's server-side RSC mode; this app is a client-side SPA that does
not use it. The only version npm offers as a "fix" is 7.11.0, which reintroduces an open
redirect that *does* affect `<Link>`/`useNavigate`, so the app stays on 7.18.1.

## Project layout

```
server/src
  index.ts          Express app, route mounting, static frontend in production
  config.ts         Environment configuration
  db.ts             SQLite connection and schema
  auth.ts           Password hashing, session cookies, auth middleware
  http.ts           HttpError, async wrapper, Zod body parsing, error middleware
  rateLimit.ts      In-process fixed-window limiter
  shoppingItems.ts  Item operations shared by the member and guest routes
  routes/           auth, household, categories, expenses, lists, share

web/src
  api.ts            Typed fetch wrapper and response shapes
  session.tsx       Session context
  format.ts         Money and date formatting
  components/       Layout
  pages/            Login, Register, Join, Expenses, Lists, ListDetail,
                    Household, SharedList (the guest view)
```
