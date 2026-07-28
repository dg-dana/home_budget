# Home Budget

Household expenses tracker + shared shopping lists. npm workspace: `server/` (Express + SQLite) and `web/` (React + Vite).

**Read `ARCHITECTURE.md` before making changes.** It covers the data model, the two-tier access model, and the invariants that are easy to break. The checklist in §13 is the short version.

## Commands

```bash
npm install
npm run dev        # API :4000 + Vite :5173
npm test           # vitest, server integration suite (108 tests)
npm run test:e2e   # playwright, guest-flow smoke test (6 tests)
npm run test:all   # both
npm run typecheck  # both workspaces + e2e/
npm run build      # server/dist + web/dist
npm start          # production: one process, serves API + built frontend
```

## Testing

- `npm test` — `server/test/`, real HTTP against a real SQLite DB, no mocks. Each test file gets its own database.
- `npm run test:e2e` — `e2e/`, Playwright against the **production build** (it runs `npm run build && npm start` itself). Covers the guest flow only.
- **Do not run `playwright install`** — the sandbox ships a prebuilt Chromium and the config finds it.
- Coverage gap: everything in `web/` except the guest flow — the expenses dashboard, budgets, invites, settings. Changes there still need checking by hand.
- Adding a route means adding cases to `isolation.test.ts` (if household-scoped) and `share.test.ts` (if guest-reachable).
- **Break the code once and watch the new test fail before trusting it.** A test that has never failed has not been shown to test anything.

## Schema changes

Migrations live in `server/src/migrations.ts` and run on every boot. **Add a new migration; never edit or reorder one that has shipped.** Ids are recorded in `schema_migrations`, so they must stay stable.

## The three rules most easily broken

1. **Every household-scoped query filters on the caller's `household_id` in the SQL itself.** Never trust a client-supplied id; use `assertOwned()` for foreign ids.
2. **Money is integer cents everywhere.** Convert only at the API boundary and at display time.
3. **`/api/share/:token` and `/s/:token` are unauthenticated by design.** They must keep working with no cookie, and must never expose anything beyond the one list's name and items.

Also worth knowing: recurring expenses materialise **on read** (`GET /expenses` and friends write). It is idempotent via `last_generated_on` — see `ARCHITECTURE.md` §7 before touching it.

## Housekeeping

Keep `ARCHITECTURE.md` and this file current in the same commit as the change they describe — not afterwards.
