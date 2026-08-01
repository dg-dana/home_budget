---
name: preview-ui
description: Screenshot any page of this app in a real browser, in light and dark, at desktop and phone width, with a household's worth of data already in it. Use when a change touches web/ and you need to see it rather than reason about it — the expenses dashboard, recurring, shopping lists, household settings, statistics, the guest share page, or anything about theming, layout or responsive behaviour. Also use to check a page is reachable and renders before calling a UI change done.
---

# Looking at a UI change

Most of `web/` has no automated coverage: the guest flow, the sign-in page's
theme toggle and the statistics page are tested, and nothing else is. For every
other page — the expenses dashboard, recurring, lists, household — the only way
to know what a change did is to look at it.

This skill makes looking cheap. `preview.mjs` builds the app, runs the
production build on a spare port against a throwaway database, seeds a
household with three months of expenses across three people, signs in, and
screenshots whatever routes you name in both themes at both widths.

**Reasoning about the CSS is not a substitute.** Two bugs in this project's
history were invisible to every test and to a careful reading of the diff: a
theme that never applied, and a control that existed but sat on no screen
anybody looked at.

## Running it

```bash
node .claude/skills/preview-ui/preview.mjs /            # the expenses dashboard
node .claude/skills/preview-ui/preview.mjs /stats /lists /household
node .claude/skills/preview-ui/preview.mjs /s/:token    # the guest share page
```

Requires `npm install` to have been run. The first run builds; add
`--skip-build` on later runs against the same code and it takes seconds.

Routes are app paths. Two get substituted from the seed, so you never have to
paste an id:

| You write | It opens |
| --- | --- |
| `/lists/:id` | the seeded "Supermarket" list |
| `/s/:token` | that list's share link, **in a context with no cookie** but with a guest name already chosen, so it opens on the list rather than the name prompt |

Flags:

| Flag | Default | |
| --- | --- | --- |
| `--themes light,dark` | both | `system` is also valid |
| `--widths 1100,390` | both | desktop and phone |
| `--out <dir>` | `.preview/` | git-ignored |
| `--skip-build` | off | reuse `server/dist` + `web/dist` as they are |
| `--fold` | off | viewport only, instead of the full page |
| `--keep-open` | off | leave the server up and print the sign-in details |

Then **read the PNGs**. `.preview/<route>-<theme>-<width>.png`.

## What it tells you besides the picture

Each line of the summary carries three things worth reading:

- **`body rgb(...)`** — proof the theme actually applied. Light is
  `rgb(246, 247, 249)`, dark is `rgb(11, 17, 32)`. If light and dark come back
  the same, the script says so: either the theme did not apply or the page
  paints its own background instead of using the variables (`ARCHITECTURE.md`
  §9.1).
- **`in header` / `NOT LINKED FROM HEADER`** — whether anyone can reach the
  page. A page nobody can navigate to is a page nobody has. Only asked of
  routes with no `:parameter`, since a detail page is reached from its parent
  by design.
- **`!` lines** — console errors, uncaught exceptions and failed requests
  during that page load. The 401 from `/auth/me` on a signed-out page is
  filtered; it is how `SessionProvider` decides nobody is signed in.

## What it seeds

Enough that no page is empty: a household of three (Dana the owner, Yossi,
Noa), expenses over the current and previous two months across six categories,
one active monthly recurring rule, and two shopping lists — one of them shared.
One item on the shared list carries a comment, so that row is looked at the way
it renders when it is full rather than bare.
Built through the API, the same shape `e2e/helpers.ts` uses.

If you need a different shape — an empty state, one person, a category past the
sixth series colour — edit `seed()` in `preview.mjs` for the run and put it
back, or use `--keep-open` and drive the running app yourself.

## This is for looking, not for proving

A screenshot confirms a change today; it does not stop it regressing tomorrow.
When what you have checked is an invariant rather than an appearance — a
control that must exist, a guest who must not see something — write the test
too, and **break the code once to watch it fail** (`ARCHITECTURE.md` §10).
`e2e/statistics.spec.ts` is the pattern to copy.

## Notes for the sandbox

- **Never run `playwright install`.** The script finds the prebuilt Chromium at
  `/opt/pw-browsers/chromium`, falls back to globbing the versioned directory,
  and falls back again to a normally installed browser on a laptop. Override
  with `CHROMIUM_PATH`.
- It runs with `NODE_ENV=development` on purpose. Production cookies are
  `Secure` and would be dropped over plain http, so sign-in would fail. That
  also lets `RATE_LIMITS=off` apply, which matters because one run signs in
  several times a minute. `config.ts` ignores that variable in production, so
  it cannot un-protect the live site.
- The server runs in its own process group and is killed by group at the end.
  Do not reach for `pkill -f` to clean up — the pattern matches the calling
  shell's own command line and kills the call itself (exit 144, no output).
- Every run gets its own SQLite file in `/tmp`, deleted at the end. `--keep-open`
  leaves it, and says so.
- **This tells you nothing about production.** The sandbox cannot reach
  `home-budget-dg.app` — the egress proxy refuses it by policy. What renders
  here is what the code does, not what the live site is serving.
