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

Gaps are split in two, and the split is the point:

- **"takes an id from the caller"** — the route accepts a `:id` or `:token` from
  whoever called it. That is precisely what one household would use to reach
  into another's rows, and precisely what `assertOwned()` exists for. Treat
  these as a to-do list.
- **"no path parameter"** — the route can still return the wrong household's
  data if its `WHERE` clause is wrong, but nobody can *aim* it. Worth a case,
  less urgent.

Auth routes are exempt: they are not household-scoped, and `auth.test.ts`
covers registration, cookies and the invite lifecycle in its own terms.

## What it does not tell you

**It matches on method and path shape.** That proves a suite *reaches* a route.
It says nothing about whether the case asserts the right thing — a test that
calls `DELETE /api/lists/:id` as the wrong household and then asserts nothing
counts as reached here and protects nothing.

So this is a checklist, not a guarantee. The guarantee is still the same one
§10 describes: write the case, then **break the code once and watch it fail.**
An unreached route is definitely untested; a reached one is merely a candidate.

Nor does an unreached route mean a broken one. When this was first run, all 15
gaps turned out to be correctly filtered code that no test had ever exercised.
Untested and broken are different findings — check the handler before reporting
one as the other.

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
