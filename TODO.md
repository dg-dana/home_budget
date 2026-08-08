# TODO

The running state of this project. **Updated after every step** — see the
"Working agreement" in `CLAUDE.md`.

Last updated: 2026-08-08 · live: deploy run #36 (`9644a62`)

German emails are live and **confirmed arriving**.

---

## The German work is finished

Interface, money and dates, emails and refusals from the API — all of it reads
in whichever language the person is in, and the choice follows their account
rather than their browser. Runs #33 to #36, every one of them confirmed by hand
on the real site.

The one thing still English in both languages is **Zod schema failures**, and
that is deliberate: they name a field, which beats a translated generality, and
no form can reach them.

## Live: translated refusals

**Deployed on run #36** (`9644a62`) and **confirmed by hand** — a wrong password
on a German page answers in German.

The last thing in the app that spoke English
regardless of who was reading: when the API refused something, the page printed
the server's sentence verbatim. A German page answered a wrong password in
English.

The API now sends a **code** beside the sentence, and the page turns that into
whichever language is on screen.

Three things about it are load-bearing:

- **The English sentence stays, and stays the contract.** It is what a `curl`, a
  log line and any client that has never heard of codes have to go on. `code`
  and `vars` are additive — nothing that read the old shape breaks.
- **An unknown code falls back to the English.** A gap is untranslated rather
  than broken, which is what makes partial coverage safe — and also what would
  let a gap go unnoticed forever, which is why there is a test.
- **`errorCodes.test.ts` reads `web/src/strings.ts` from the server suite** and
  fails if a code has no sentence or a sentence has no code. TypeScript cannot
  span two packages when the thing crossing is a string on a wire, so this is
  the only thing holding the halves together.

Interpolated values travel as `vars` rather than baked into the sentence — the
same rule the emails follow, and for the same reason: a sentence assembled on
the server could only ever be English.

Four deliberate breaks were watched failing: a code renamed in the dictionary,
the middleware dropping `code`, the page preferring the server's sentence over
the translation, and a value baked into a message instead of sent beside it.

**What stays English, deliberately: Zod schema failures.** They name a field and
say what is wrong with it, which beats a translated "check that form" — and they
are unreachable through the interface, since every form carries the same
`required`, `minLength` and `maxLength` the schemas do. What reaches that path
is a script or a stale client.

## Needs your hands

None of these can be done from an agent sandbox: the egress proxy refuses the
live domain by policy, so anything about the real site is yours.

- [ ] **Say if the notices are too much or too little.** Wording and who hears
      what are both easy to change; what is hard is noticing later that nobody
      reads them. `ARCHITECTURE.md` §4.1 has the table.
- [ ] **Check the rest of the live site on a phone.** The Household page was
      checked on run #25, leaving a household on run #26, and password recovery
      on runs #27–#28 — all look right. What runs #17–#24 shipped still has
      not been: the new sign-up flow, the household switcher, "Make owner", and
      that your existing household looks untouched. A green deploy proves the
      URL responds, nothing more.

## Open work

Everything below except the first is an **accepted trade-off** rather than
queued work: it is written down so nobody rediscovers it as a surprise, and
each says why it stays. The first one is a real gap.

- [ ] **Most of the frontend has no browser tests.** Covered: the guest flow,
      the statistics page, the household switcher, and language and theme.
      **Not covered: the expenses dashboard, budgets, recurring rules, invites,
      and the Household page** — which is where the money is entered and where
      the irreversible buttons live. Changes there are checked by looking at a
      screenshot, and a screenshot proves today, not tomorrow. Two bugs in this
      project's history were invisible to every test *and* to a careful reading
      of the diff. This is the one item here that would repay doing. (§14)
- [ ] **One account, one pair of preferences.** A phone and a laptop can no
      longer disagree about language or theme — whichever was changed last wins
      everywhere. Deliberate: keeping both would mean the app ranking devices.
      Say if it grates. (§9.1b)
- [ ] **Zod schema failures answer in English, in both languages.** Deliberate:
      they name a field, which beats a translated generality, and the forms
      carry the same constraints the schemas do so nothing reaches them through
      the interface. "Unreachable" is a claim about today's forms, though — a
      new form that forgets a `maxLength` would quietly make it reachable. (§14)
- [ ] **Native date and month pickers ignore the page's language.** Chrome
      renders `<input type="date">` in the *browser's* UI language, so a German
      page on an English browser still shows `08/07/2026`. Only replacing the
      native pickers would change it, which costs more than it buys. (§9.1a)
- [ ] **An owner still reaches any account in their household where email is
      unconfigured.** What was the general case is now the exception: with a
      mail provider the route is refused. Without one it stays, because the
      alternative is a locked-out member with no way back in. The fix is
      configuring email, which is one secret. (§14)
- [ ] **`POST /auth/forgot` is quiet about existence but not about timing** —
      an address with an account waits for the provider, one without answers
      at once. The per-address budget is what makes that useless in practice.
      (§14)
- [ ] **Polling is 15-second HTTP, not a push.** Every shopping page keeps up
      now, but a change still takes up to fifteen seconds to appear and each
      open page costs a request. SSE or a WebSocket would be immediate and
      cheaper at rest — and not worth a persistent connection on a 512 MB box
      for a household of four. (§14)
- [ ] **"Verification" means less on an unconfigured deployment.** With no
      `RESEND_API_KEY` the confirmation link is handed straight to whoever
      registered, so it is a step in the flow rather than a check. Right trade
      for the suite and local work; worth remembering before relying on
      "confirmed" as proof of anything. (§14)

## Done

- [x] **Refusals from the API are translated** — the server sends a code beside
      its English sentence, the page renders whichever it can, and a test that
      reads the web dictionary from the server suite fails if the two ever drift
      apart. Values travel as `vars` rather than baked into the sentence. Four
      deliberate breaks watched failing. (PR #67, live on run #36, **confirmed
      by hand**)
- [x] **Language and theme stick to the account** — adopted on sign-in, written
      back on every change, so a browser losing its `localStorage` no longer
      loses the choice with it. Signed-out and guest screens are unchanged.
      Migration `006` shipped without moving anything under anybody, because an
      account that has never saved a pair lets the device win once. Four
      deliberate breaks watched failing. (PR #65, live on run #35, **confirmed
      by hand, including across machines**)
- [x] **Emails go out in German too** — per recipient, not per request, so one
      household with two languages gets two versions of the same message.
      `users.language` (migration `005`), set at registration and followed by
      `PUT /auth/preferences`; `notificationStrings.ts` as the server's
      dictionary; routes handing notices values rather than phrases. Five
      deliberate breaks watched failing. (PR #63, live on run #34, **confirmed
      arriving**)
- [x] **English and German across the whole interface**, per device, on every
      screen including the guest's — dictionary in `web/src/strings.ts`, one
      entry per string with both languages; whole sentences rather than glued
      fragments; money and dates following the choice as well as the words;
      `<html lang>` set before first paint. Three browser tests, each watched
      failing against a deliberate break. (PR #60, live on run #33,
      **confirmed by hand on the real site**)
- [x] **"Copy list" carries only what is still to buy** — the ticked-off items
      are gone from the text entirely, since a list naming what the reader is
      already carrying is worse than no list. (PR #58, live on run #32)
- [x] **Nobody is asked to join a household they are already in** — `alreadyIn`
      in the invite preview, so the page offers to open it; an address already
      in the household cannot be invited at all; and that refusal shows under
      the invite form rather than at the top of a page several screens long.
      (PRs #53 and #54, live on runs #30 and #31, **confirmed by hand on the
      real site**)
- [x] **Invite email confirmed arriving on the live site**, which was the last
      message type nobody had watched land. Every kind the app sends is now
      either proven end to end (confirmation, recovery, invite) or shares the
      same `deliver()` path with one that is. It turned up a rough edge in the
      join page rather than in the sending — see "Open work".
- [x] **Every shopping page keeps itself current** — one `usePoll` hook on the
      lists index, a member's list and the guest's, refetching every 15 s,
      skipping a hidden tab and refetching the moment one becomes visible.
      Closes the split where only the guest page kept up. The browser test for
      it is the only one where waiting *is* the assertion. (PR #49, live on run
      #29, **confirmed on two real phones** — one adds, the other shows it with
      nobody reloading)
- [x] **Owner-issued recovery retired to a fallback** — refused (403) wherever
      email is configured, button hidden, `ownerRecovery` in the session
      payload telling the frontend which world it is in. Still working where
      nothing can send email, because there it is the only way back in. Both UI
      states were looked at in a browser rather than reasoned about. (PR #47,
      live on run #28, **confirmed by hand on the real site**)
- [x] Self-service "forgot password" — `POST /auth/forgot` and the `/forgot`
      page, linked from sign-in. Same answer whether or not the address exists,
      the link only ever in the email, 5 requests an hour per address, and a
      refusal rather than a fallback when nothing can send mail. Timing still
      separates the two cases and the per-address budget is the whole defence,
      which is written down rather than implied. (PR #43, live on run #27,
      **confirmed by hand on the real site** — the email arrived and the link
      worked. `ARCHITECTURE.md` §4)
- [x] **A real message has now landed in a real inbox.** The reset email above
      is the first one anybody has seen arrive, which answers the open question
      email sending has carried since run #24: Resend, `MAIL_FROM` and
      `APP_URL` are all right on the live deployment, and the absolute link
      built from `APP_URL` resolves. Invites and confirmations go through the
      same `deliver()`, so the provider is proven for all of them — an invite
      specifically still has not been watched arrive.
- [x] Leave a household without deleting your account — "Leave this household"
      in the Danger zone, `DELETE /household/members/me`. Refused for the only
      owner with company and for the last person in the household; no password
      on it, because a new invite undoes leaving. The route is registered
      before `/members/:id` so `requireOwner` cannot swallow it, and the
      Danger zone card went back to rendering for everyone with only the
      delete form owner-only. (PR #37, live on run #26, **confirmed by hand**)
- [x] **"Delete my account" is gone from the Household page** — it lives on
      `/households` only (live, run #25). It ends the account and every
      membership it holds, so sitting beside "Delete this household" made it
      read as something scoped to the household you happened to have open. The
      foot of `/household` keeps the household deletion, with a link across to
      Your households. The server was untouched: `DELETE /auth/account` still
      exists and `/households` still calls it. (PRs #38, #39 — live on run #25
      and **confirmed by hand**.) It was briefly an owner-only card; run #26
      put leaving in it, so only the delete form is owner-only now.
- [x] **CI is creating runs again.** Pushes after 15:27 UTC on 2026-08-06
      produced no Actions run at all, which cost PR #35 its safety net. Runs
      #156–#163 fired normally on 2026-08-07, push and `pull_request` alike,
      so nothing needs changing in the repository's Actions or billing
      settings. It went quiet on its own and came back on its own — if that
      happens again, check the Actions tab before assuming a push failed.
- [x] Email sends through Resend, and the app also emails what has happened —
      joins, removals, role changes, renames, both deletions, password
      changes (`ARCHITECTURE.md` §4.1 has the table of who hears what). Two
      follow-ups came with it: a delivered notice **stops showing its link**
      and offers "send it again" instead, since printing a live credential
      beside "we emailed you" reads as a failed send; and an invitation is
      listed on `/households`, for whoever registered from the email and never
      opened the link again. (live, runs #20–#24 — and **proven to reach a real
      inbox** by the reset email on run #27, which was the open question for
      three runs)
- [x] Delete an account / delete a household — "Danger zone" (live, run #16,
      confirmed on a phone)
- [x] Accounts separate from households; several per account; per-household
      display name; email confirmation flow (live, run #17)
- [x] Switcher reachable with only one household — was a dead end (live, run #18)
- [x] Promote a member to owner / demote back — "Make owner" on the Household
      page. Never your own role, which is what keeps an owner in every
      household. (live, run #19)
