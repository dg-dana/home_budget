---
name: route-coverage
description: List every API route the app registers and which ones no isolation or share test ever calls. Use when adding, moving or renaming a route in server/src/routes, when reviewing whether a change is adequately tested, or when asked what is missing from isolation.test.ts or share.test.ts. Also use before finishing any server-side change that adds an endpoint.
---

# Which routes no isolation test reaches

Rule 1 of this codebase: **every household-scoped query filters on the caller's
`household_id` in the SQL itself**, and `assertOwned()` guards any id the client
supplied. `isolation.test.ts` is what holds that up — `ARCHITECTURE.md` calls it
the most important file in the suite.

§15 step 6 says a new household-scoped route gets a case in `isolation.test.ts`,
and anything a guest can reach gets one in `share.test.ts`. Nothing enforces
that. Forget it and every test still passes.

```bash
node .claude/skills/route-coverage/audit.mjs
```

It reads the routers, resolves their mount prefixes from `app.ts`, and reports
which routes the two suites never call.

| Flag | |
| --- | --- |
| `--all` | print every route, reached ones included |
| `--strict` | exit 1 when anything is unreached, for a hook or CI |

## Reading the output

Two lists, and the difference between them is the whole point:

- **"Called by no test at all"** — no file in `server/test/` touches the route.
  Nothing would notice if the handler stopped filtering on `household_id`. This
  is the list that matters. A `<- takes an id from the caller` marker means the
  route accepts a `:id` or `:token`, which is what `assertOwned()` exists for
  and what one household would use to reach into another's rows.
- **"Exercised elsewhere"** — some test calls it, just not the file §15 names.
  **Usually fine.** `recurring.test.ts` keeps its own cross-household case
  rather than putting it in `isolation.test.ts`, and that is a reasonable place
  for it. Scan the column, do not act on it reflexively.

Auth routes are exempt: they are not household-scoped, and `auth.test.ts`
covers registration, cookies and the invite lifecycle in its own terms.

`--strict` fails only on the first list.

## What it does not tell you

**It matches on method and path shape.** That proves a suite *reaches* a route.
It says nothing about whether the case asserts the right thing — a test that
calls `DELETE /api/lists/:id` as the wrong household and then asserts nothing
counts as reached here and protects nothing.

So this is a checklist, not a guarantee. The guarantee is still the same one
§10 describes: write the case, then **break the code once and watch it fail.**
An uncalled route is definitely untested; a called one is merely a candidate.

Nor does uncalled mean broken. Every route this flagged on its first run turned
out to be correctly filtered code — some of it simply tested in another file.
Untested and broken are different findings, and so are "untested" and "tested
somewhere I did not look". Read the handler before reporting any of them.

That last mistake is the one this script was rewritten to stop making: it first
read only `isolation.test.ts` and `share.test.ts`, called 15 routes gaps, and
13 of them were covered elsewhere. **A tool that cries wolf gets ignored**, so
it now reads every `*.test.ts` in `server/test/` before calling anything a gap.

## If it misses something

The matcher normalises both sides to a shape: `/api/lists/${list.body.id}/items`
and `/api/lists/:id/items` both become `/api/lists/:x/items`. It recognises
`${…}` interpolation, `:params` and bare UUIDs. A test that builds a path some
other way — string concatenation, a helper that returns a URL — will not be
seen, and its route will be reported unreached. Fix the report by making the
call literal, or teach `shape()` the new form.

It parses source text rather than booting the app, so a route registered
somewhere unusual — not `<name>Router.<method>('<path>')` inside
`server/src/routes/` — is invisible to it. Both suites getting zero routes is
the symptom of a parser that has fallen behind a refactor.
