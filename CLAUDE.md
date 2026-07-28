# Home Budget

Household expenses tracker + shared shopping lists. npm workspace: `server/` (Express + SQLite) and `web/` (React + Vite).

**Read `ARCHITECTURE.md` before making changes.** It covers the data model, the two-tier access model, and the invariants that are easy to break. The checklist in §12 is the short version.

## Commands

```bash
npm install
npm run dev        # API :4000 + Vite :5173
npm test           # vitest, server integration suite
npm run typecheck  # both workspaces (server config also covers test/)
npm run build      # server/dist + web/dist
npm start          # production: one process, serves API + built frontend
```

## Testing

- `npm test` runs 75 integration tests in `server/test/` — real HTTP against a real SQLite DB, no mocks. Each test file gets its own database.
- The server is well covered; **the frontend has no tests**, so changes under `web/` still need checking by hand in the running app.
- Adding a route means adding cases to `isolation.test.ts` (if household-scoped) and `share.test.ts` (if guest-reachable).
- **Break the code once and watch the new test fail before trusting it.** A test that has never failed has not been shown to test anything.

## The three rules most easily broken

1. **Every household-scoped query filters on the caller's `household_id` in the SQL itself.** Never trust a client-supplied id; use `assertOwned()` for foreign ids.
2. **Money is integer cents everywhere.** Convert only at the API boundary and at display time.
3. **`/api/share/:token` and `/s/:token` are unauthenticated by design.** They must keep working with no cookie, and must never expose anything beyond the one list's name and items.

## Housekeeping

Keep `ARCHITECTURE.md` and this file current in the same commit as the change they describe — not afterwards.
