# Home Budget

Household expenses tracker + shared shopping lists. npm workspace: `server/` (Express + SQLite) and `web/` (React + Vite).

**Read `ARCHITECTURE.md` before making changes.** It covers the data model, the two-tier access model, and the invariants that are easy to break. The checklist in §15 is the short version.

## Commands

```bash
npm install
npm run dev        # API :4000 + Vite :5173
npm test           # vitest, server integration suite (132 tests)
npm run test:e2e   # playwright, guest-flow smoke test (8 tests)
npm run test:all   # both
npm run typecheck  # both workspaces + e2e/
npm run build      # server/dist + web/dist
npm start          # production: one process, serves API + built frontend
npm run backup     # consistent SQLite snapshot (online backup API, not cp)
```

## Testing

- CI (`.github/workflows/ci.yml`) runs typecheck plus both suites on every push.
- `npm test` — `server/test/`, real HTTP against a real SQLite DB, no mocks. Each test file gets its own database.
- `npm run test:e2e` — `e2e/`, Playwright against the **production build** (it runs `npm run build && npm start` itself). Covers the guest flow only.
- **Do not run `playwright install`** — the sandbox ships a prebuilt Chromium and the config finds it.
- Coverage gap: everything in `web/` except the guest flow — the expenses dashboard, budgets, invites, settings. Changes there still need checking by hand.
- Adding a route means adding cases to `isolation.test.ts` (if household-scoped) and `share.test.ts` (if guest-reachable).
- **Break the code once and watch the new test fail before trusting it.** A test that has never failed has not been shown to test anything.

## Deployment

AWS Lightsail: one VPS, Docker Compose, app + Caddy for TLS. See `DEPLOY.md` for the runbook and `ARCHITECTURE.md` §11 for why.

Live instance: `home-budget-dg.app` (Cloudflare DNS) → `3.68.141.55`, Lightsail `eu-central-1`. `DEPLOY.md` §"This deployment" tracks how far the setup has got — check it before walking anyone through the steps.

Deploy, backup, restore and diagnostics all run from the GitHub Actions tab, not a local terminal — assume whoever maintains this may only have a tablet.

**When the site will not load, run "Diagnose the deployment" first** and read the run summary. It checks the visitor's path from the outside in (DNS → 443 → 80 → certificate → HTTP) before looking inside the server, and it changes nothing.

- The image is built in CI and pulled by the server; **never build on the instance** (a Vite build will exhaust a small box).
- `JWT_SECRET` must stay stable or every session is invalidated. `bootstrap.sh` will not regenerate an existing one.
- HTTPS is required, not cosmetic: production cookies are `Secure`, so plain HTTP breaks sign-in.
- **Never advertise a protocol the firewall drops.** Caddy pins `protocols h1 h2` because compose publishes TCP 443 only; enabling HTTP/3 without also opening UDP 443 makes browsers hang on a blank page. `DEPLOY.md` §"Enabling HTTP/3".
- A green deploy does not mean a reachable site. The container health check runs *inside* the app container — the public URL is verified separately, at the end of the deploy.
- **Changing `deploy/Caddyfile` requires reloading Caddy**, which the deploy now does. `docker compose up -d` will not do it for you: the file is bind-mounted, so its contents are not part of the service definition and Compose leaves the container alone. Copying a new Caddyfile without a reload deploys green and changes nothing.
- **The instance is memory-tight.** 416 MB usable, and it wedged twice on 2026-07-30/31 — unreachable on every port, needing a Lightsail **Force stop**. 1 GB of swap now covers it (`DEPLOY.md` §"Memory headroom"), but before blaming the app for an outage, check `free -m` and the OOM line in the diagnostic. If it wedges again, the answer is the 1 GB bundle, not more patching.

## Current state (2026-07-31)

Things a fresh session would otherwise have to rediscover. Delete lines here as
they stop being true.

- **The default branch is `claude/expenses-shopping-app-4bmukm`**, not `main`. Early work was pushed straight to it; PR #1 (dark mode) was the first to go through review and was squash-merged. Note that GitHub only lists a `workflow_dispatch` workflow once it exists on the default branch — a new workflow added on a side branch is invisible in the Actions tab until merged.
- **Merging does not deploy.** `deploy.yml` is `workflow_dispatch` only, so a merged change sits in the repo until someone runs **Deploy to Lightsail** from the Actions tab. Deploy run #4 (2026-07-31) shipped the dark mode work and the pending `deploy/Caddyfile` formatting change.
- **Swap is newly added and unproven over time.** It was holding ~114 MB within eight minutes of boot, so the pressure is continuous rather than a spike. The nightly backup at 03:17 UTC is the suspected trigger for both wedges, but the evidence went with the reboot (`dmesg` is per-boot), so that stays a theory.
- The `DOMAIN` repository variable is set, so **Diagnose the deployment** needs no inputs.

## Schema changes

Migrations live in `server/src/migrations.ts` and run on every boot. **Add a new migration; never edit or reorder one that has shipped.** Ids are recorded in `schema_migrations`, so they must stay stable.

## The three rules most easily broken

1. **Every household-scoped query filters on the caller's `household_id` in the SQL itself.** Never trust a client-supplied id; use `assertOwned()` for foreign ids.
2. **Money is integer cents everywhere.** Convert only at the API boundary and at display time.
3. **`/api/share/:token` and `/s/:token` are unauthenticated by design.** They must keep working with no cookie, and must never expose anything beyond the one list's name and items.

Theming: colours are `light-dark()` pairs in one `:root` block, and the only two
rules that name a theme set nothing but `color-scheme` (`ARCHITECTURE.md` §9.1).
**The pre-paint script in `web/index.html` duplicates `applyTheme()` in
`web/src/theme.ts` deliberately — change both or dark-mode devices flash white.**
The toggle reaches every screen through two places: the two headers, and
`AuthPage` for everything signed-out. A new signed-out page that renders a bare
`<div className="auth-page">` instead of `<AuthPage>` silently loses it.

Also worth knowing: changing a password bumps `users.session_generation`, which invalidates that user's other sessions — a counter rather than a timestamp, deliberately (`ARCHITECTURE.md` §4).

Recurring expenses materialise **on read** (`GET /expenses` and friends write). It is idempotent via `last_generated_on` — see `ARCHITECTURE.md` §7 before touching it.

## Housekeeping

Keep `ARCHITECTURE.md` and this file current in the same commit as the change they describe — not afterwards.
