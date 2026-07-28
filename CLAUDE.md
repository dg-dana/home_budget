# Home Budget

Household expenses tracker + shared shopping lists. npm workspace: `server/` (Express + SQLite) and `web/` (React + Vite).

**Read `ARCHITECTURE.md` before making changes.** It covers the data model, the two-tier access model, and the invariants that are easy to break. The checklist in §11 is the short version.

## Commands

```bash
npm install
npm run dev        # API :4000 + Vite :5173
npm run build      # server/dist + web/dist
npm run typecheck  # both workspaces
npm start          # production: one process, serves API + built frontend
```

There are no automated tests yet. Verify changes by building and exercising the affected flow in the running app.

## The three rules most easily broken

1. **Every household-scoped query filters on the caller's `household_id` in the SQL itself.** Never trust a client-supplied id; use `assertOwned()` for foreign ids.
2. **Money is integer cents everywhere.** Convert only at the API boundary and at display time.
3. **`/api/share/:token` and `/s/:token` are unauthenticated by design.** They must keep working with no cookie, and must never expose anything beyond the one list's name and items.
