# Home Budget

Household expenses tracker + shared shopping lists. npm workspace: `server/` (Express + SQLite) and `web/` (React + Vite).

**Read `ARCHITECTURE.md` before making changes.** It covers the data model, the two-tier access model, and the invariants that are easy to break. The checklist in §15 is the short version.

## Commands

```bash
npm install
npm run dev        # API :4000 + Vite :5173
npm test           # vitest, server integration suite (142 tests)
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
- Coverage gap: everything in `web/` except the guest flow and the sign-in page's theme toggle — the expenses dashboard, budgets, statistics, invites, settings. Changes there still need checking by hand.
- **To check a UI change by hand**, build and run the real thing rather than reasoning about the CSS: `npm run build`, then `npm start` on a spare port with a throwaway `DATA_DIR`, and drive it with Playwright using the sandbox's Chromium (`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'` — the version dir moves, so glob `/opt/pw-browsers/chromium-*`). Screenshot at 1100px and 390px. Reading `getComputedStyle(document.body).backgroundColor` is the cheap way to prove a theme actually applied.
- Beware `pkill -f <pattern>` in a tool call: the pattern matches the shell's own command line, so it kills the call itself (exit 144, no output). Use a self-excluding pattern like `dist/inde[x].js`.
- Adding a route means adding cases to `isolation.test.ts` (if household-scoped) and `share.test.ts` (if guest-reachable).
- **Break the code once and watch the new test fail before trusting it.** A test that has never failed has not been shown to test anything.

## Deployment

AWS Lightsail: one VPS, Docker Compose, app + Caddy for TLS. See `DEPLOY.md` for the runbook and `ARCHITECTURE.md` §11 for why.

Live instance: `home-budget-dg.app` (Cloudflare DNS) → `3.68.141.55`, Lightsail `eu-central-1`. `DEPLOY.md` §"This deployment" tracks how far the setup has got — check it before walking anyone through the steps.

Deploy, backup, restore and diagnostics all run from the GitHub Actions tab, not a local terminal — assume whoever maintains this may only have a tablet.

**When the site will not load, run "Diagnose the deployment" first** and read the run summary. It checks the visitor's path from the outside in (DNS → 443 → 80 → certificate → HTTP) before looking inside the server, and it changes nothing.

**You cannot reach the live site from an agent sandbox.** The egress proxy refuses `home-budget-dg.app` by policy (`connect_rejected`, 403 on CONNECT — visible in `curl -sS "$HTTPS_PROXY/__agentproxy/status"`). Do not read that as the site being down, and do not try to route around it. To check what production is actually serving, use the deploy's own "Verify the public URL works" step, the diagnostic workflow, or ask whoever has a browser.

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

- **The default branch is `claude/expenses-shopping-app-4bmukm`**, not `main`. Early work was pushed straight to it; PRs #1, #2, #4 and #6 (dark mode, the signed-out toggle, the statistics page, then its pies) went through review and were squash-merged. Note that GitHub only lists a `workflow_dispatch` workflow once it exists on the default branch — a new workflow added on a side branch is invisible in the Actions tab until merged.
- **Merging does not deploy.** `deploy.yml` is `workflow_dispatch` only, so a merged change sits in the repo until someone runs **Deploy to Lightsail** from the Actions tab. Live as of deploy run #7 (2026-07-31, `9a7b9ca`): the statistics page with the per-person pies, on top of dark mode including the signed-out toggle and the `deploy/Caddyfile` formatting change. Every step passed, "Verify the public URL works" included — but an agent sandbox cannot load the site, so a browser is still the last word.
- **"Merged" and "deployed" and "reachable" are three different things**, and the dark mode work missed on all three in turn: PR #1 merged and sat undeployed; deploy run #4 shipped it and it still could not be found, because the toggle was in the two headers only and the sign-in page — the screen you land on — had no control on it. When someone says a feature is missing, check what is actually deployed *and* whether the control exists on the screen they are looking at, before defending the code.
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
