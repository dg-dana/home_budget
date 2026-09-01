# TODO

The running state of this project. **Updated after every step** — see the
"Working agreement" in `CLAUDE.md`.

Last updated: 2026-09-01 · live: deploy run #43 (`5abad32`)

German emails are live and **confirmed arriving**.

---

## Live: the new password rules

**Deployed on run #38** (`e33a4d6`) — all 17 steps green. Passwords now follow **current guidance rather
than the folk version of it**, which is worth saying plainly because the two
point in opposite directions.

The rule is **length: 12 characters, up from 8.** There are deliberately **no**
"must contain a capital, a digit and a symbol" rules, and no forced expiry.
Those do not produce strong passwords — they produce `Password1!`, because
everybody satisfies them the same predictable way. NIST 800-63B advises
verifiers against both. `passwords.test.ts` has cases whose entire job is to
fail if a composition rule is ever added, since that is the change a
well-meaning tightening makes first.

Three checks sit beyond length, each aimed at what people actually type when a
minimum is in the way:

- **The commonest 10,000, and their stems.** The stem check is the one that
  earns its place: only **ten** entries in that list are 12 characters or
  longer, so at this minimum an exact-match lookup is nearly decoration. Told
  to type twelve, people pad what they already use — so `password1234` fails
  for the same reason `password` does.
- **Runs and keyboard walks** — `aaaaaaaaaaaa`, `123456789012`, `qwertyuiopas`.
  Every one clears a length rule and appears in no top-10,000 list, because
  those lists are full of short passwords.
- **Your own email address, and the name of this app.**

The ceiling is **72 bytes, because that is what bcrypt actually reads.** Past
it the tail is silently ignored, so a longer password would be stored weaker
than it was typed. Refusing is honest; truncating is not.

**Nothing changes for anyone already signed up.** The rules run only where a
password is *set*, never at sign-in, so an existing shorter password keeps
working. Forced rotation makes passwords worse, not better. The new rule
applies the next time somebody sets one.

The refusals are translated, so a German page explains why a password was
refused in German — a rule nobody can read is a rule that just looks broken.

Five deliberate breaks were watched failing, including the one that matters:
adding a composition rule fails five passphrase cases at once.

## Live: browser tests for the two untested pages

**Deployed on run #37** (`ddf6840`) — all 17 steps green. There is nothing to
look at on the site: this is tests, plus one small fix they turned up.

The two pages with no browser coverage at all were the two that matter most:
the **expenses dashboard**, where the money is entered, and the **Household
page**, where the buttons that cannot be undone live. Eight tests now cover
them, and each was watched failing against a deliberate break.

They ask what only a browser can see:

- **Who is shown which control.** The Danger zone card was briefly owner-only,
  correctly, back when deleting the household was the only thing in it — and
  that shipped a page where "Leave this household" was hidden from precisely
  the people it exists for. The server was perfectly happy.
- **Where a refusal appears.** The invite error has to land *under* the form:
  the page is several screens long on a phone, so an alert at the top is one
  nobody scrolls up to see. That is a claim about pixels.
- **Whether a control the server would refuse is offered at all** — the only
  owner gets a disabled button and the reason, not a round trip.
- **Whether the summary beside the form moves when the form is used**, and
  whether editing a row arrives holding *that row's* values.

**Writing them turned up a real defect.** Every icon-only button in the app was
announced as "✕" or "✎" to a screen reader: the accessible name comes from the
button's content, and `title` is only consulted when there is none. Row
controls on the expenses, recurring, Household and shopping pages now carry an
`aria-label`. Found because a test went looking for a button by name and could
not find it — which is the kind of thing a screenshot never shows.

Two of the first breaks I tried **silently did nothing** — one patch string no
longer existed, and `hidden` loses to `.card { display: flex }`. Both looked
like passing tests. Worth remembering: a break that does not break is not
evidence, so assert the patch applied.

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

- [ ] **Try setting a weak password once, to see what it says.** On the live
      site, "Change password" on the Household page with something short — the
      refusal should explain itself, in whichever language you are reading. The
      rules only apply when a password is *set*, so your existing one keeps
      working and nothing needs doing.

- [ ] **Are the emails the right amount?** The app writes to you when something
      happens in a household: somebody joins, somebody is removed, a role
      changes, the household is renamed or deleted, a password changes. Nobody
      has said whether that is too much or too little. Too many and they start
      being ignored, which is worse than none; too few and something happens
      that you would have wanted to know about. Wording and who hears what are
      both a small change — noticing a year later that nobody reads them is
      not. (`ARCHITECTURE.md` §4.1 has the full table of who hears what.)

- [ ] **Four screens nobody has looked at on a phone.** They shipped, their
      deploys were green, and no human has opened them. A green deploy proves
      the URL responds and nothing else.

      1. **Signing up** — create an account, then create or join a household as
         a separate second step. This is the flow a new person meets first.
      2. **The household switcher** — the dropdown in the header beside the
         house icon, for moving between households.
      3. **"Make owner"** on the Household page.
      4. **Your own household** — that the expenses and lists you actually use
         still look the way they should.

      (Already checked and fine: the Household page, leaving a household,
      password recovery, German throughout, and settings sticking.)

## Open work

Everything below except the first is an **accepted trade-off** rather than
queued work: it is written down so nobody rediscovers it as a surprise, and
each says why it stays. The first one is a real gap.

- [ ] **Passwords are not checked against a breach corpus.** The bundled 10,000
      is the offline half; the other half is Have I Been Pwned's range API,
      which is the most valuable check there is and a network call per sign-up
      on an app that must work with no outbound access. Reconsider only if that
      constraint ever changes. (§14)
- [ ] **Recurring rules and the lists index still have no browser tests.** The
      two that mattered most — the expenses dashboard and the Household page —
      are covered now. What is left is smaller: pause/resume and the next-due
      date on recurring, and creating a list from the index. Worth doing, not
      urgent. (§14)
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

- [x] **The date boxes are pinned to a fixed width now, and that is the
      whole fix.** Run #43's `min-width: 0` on the input didn't work either
      — a fourth phone screenshot, this one with the problem circled, still
      showed both date boxes hanging off the right edge of the card. Three
      attempts (runs #41, #42, #43) all tried to make the control shrink to
      the space it was given, and iOS Safari simply does not: it sizes a
      native date control from its own internals and paints it at that size
      whatever `width` says. So: `input[type='date'] { width: 8.5rem }` —
      an absolute width, which it *does* honour, plus `max-width: 100%` for
      columns narrower than that. A date needs nowhere near a full column,
      so this is what it should always have been. Applies to the expenses
      page's date field too, which looks right in the preview. Chromium was
      never able to reproduce any of this, which is exactly why it took four
      rounds — **only a phone check counts here**. Typecheck, server suite
      and all 36 e2e tests pass. (No PR opened yet.)
- [x] **Run #42's date-stacking fix moved the overflow, didn't fix it.**
      Stacking the two date fields into single-column rows (run #42) was
      diagnosed wrong: a phone screenshot after that deploy showed the date
      box itself running off the right edge of the card even at full row
      width, well past the ~170px it needed — proving the problem was never
      "not enough track width." `<input type="date">`, though a normal block
      child and not a grid or flex item, still doesn't respect a percentage
      `width` below its own preferred size on iOS Safari unless `min-width`
      is reset on the *input itself*. Real fix: `min-width: 0` on the base
      `input, select, textarea` rule. Reverted the run #42 stacking
      (`.field-row.dates`, the 170px `auto-fit` floor) since it wasn't the
      actual cause — the two date fields are side by side again, matching
      the original design, and should now genuinely fit. Chromium's date
      control never showed this bug either time, so `preview-ui` can only
      confirm no regression, not that this is fixed — **this needs a real
      phone check before it's trusted**, the same way the run #42 attempt
      looked right here and wasn't. Typecheck, server suite and all 36 e2e
      tests pass. (PR #84, live on run #43 — all 17 steps green, "Verify the
      public URL works" included. **Not yet confirmed by hand — two prior
      attempts on this same bug looked fixed here and weren't, so this one
      is not to be trusted until someone actually checks it on a phone.**)
- [x] **Run #41's date-overlap fix wasn't enough on a real phone.** `min-width: 0`
      stops a grid item overflowing its track, but on iOS Safari a date input
      still won't render below roughly 170px — it just eats the gap rather
      than shrinking further, confirmed from a phone screenshot: the two date
      columns sat ~3px apart against ~40px on the Category/Paid-by row right
      above them, using the same grid. The chromium preview looked fine
      because chromium's date control shrinks further than Safari's does —
      a reminder that `preview-ui` cannot stand in for the real device
      Safari-specific behaviour needs. Fix: `.field-row.dates` raises the
      `auto-fit` minimum to 170px for just the start/end date row, so
      `auto-fit` stacks the two fields into their own full-width rows on a
      phone instead of squeezing both into one neither fits — same grid
      mechanism, just a higher floor, no media query. Only applied to the
      recurring page's date pair; the expenses page's amount+date row pairs
      a date field with a short text field, not a second date, so it wasn't
      touched — worth checking by hand if it turns out to have the same
      issue. Confirmed with `preview-ui`: stacked at 390px, still side by
      side at 1100px. Typecheck, server suite and all 36 e2e tests pass.
      (PR #82, live on run #42 — all 17 steps green, "Verify the public URL
      works" included. Not yet confirmed by hand on a phone.)
- [x] **"First charge" and "Stops after" were bumping into each other on a
      phone.** `.field-row`'s grid tracks are pinned to a 140px minimum, but
      the plain `<div>` wrapping each label+input defaults to
      `min-width: auto` — so a native date input's own intrinsic minimum
      (wider than 140px on mobile) pushed past its track into the next
      column instead of shrinking to fit it, the same class of overflow
      `.card` and `.item-main` already guard against elsewhere in
      `styles.css`. Added `.field-row > div { min-width: 0; }`. Confirmed
      with `preview-ui` at 390px — the two columns now sit with a clear gap.
      `.field-row` is shared with the expenses and households pages;
      typecheck and all 36 e2e tests still pass. (PR #80, live on run #41 —
      all 17 steps green, "Verify the public URL works" included. Not yet
      confirmed by hand on a phone.)
- [x] **Adding a recurring expense silently did nothing.** The `pattern`
      attribute PR #75 added to the amount field (`[0-9]*[.,]?[0-9]*`, meant
      as a hint) is enforced by the browser's own constraint validation —
      before React's `onSubmit` ever runs. Any value that fails to match it
      (a stray space, autocorrect, an IME quirk) blocks the request entirely
      with no console error and no visible feedback beyond a native tooltip
      mobile browsers routinely fail to show. Reproduced directly:
      `checkValidity()` false, no POST fired, no alert shown. Removed
      `pattern` from both amount fields (expenses, recurring) — the app's own
      `Number.isFinite(amount) && amount > 0` check in `handleSubmit` already
      covers correctness, with a proper translated error message. Confirmed
      the same input that silently blocked before now submits. Typecheck,
      the full server suite and all 36 e2e tests pass. (PR #78, live on run
      #40 — all 17 steps green, "Verify the public URL works" included, and
      **confirmed by hand**.)
- [x] **The amount field now takes a German comma.** `type="number"` only
      ever reads a decimal point, locale or not — a phone keyboard set to
      German sends "," and the browser silently drops it, so "3,37" landed as
      "337". Both amount fields (expenses, recurring) are now `type="text"`
      with `inputMode="decimal"`, and `normalizeAmountInput()` in `format.ts`
      reads the comma back as a period before it hits `Number()`. Typecheck,
      the full server suite and all 36 e2e tests pass. (PR #75, live on run
      #39 — all 17 steps green, "Verify the public URL works" included, and
      **confirmed by hand on a phone**.)
- [x] **Password rules brought up to current guidance** — 12 characters, the
      commonest 10,000 and their padded stems, runs and keyboard walks, and
      your own address; deliberately no composition rules and no expiry, both
      of which make passwords worse. Refusals are translated. Five deliberate
      breaks watched failing. (PR #73, live on run #38)
- [x] **Browser tests for the expenses dashboard and the Household page** —
      eight of them, each watched failing against a deliberate break. Turned up
      a real defect on the way: every icon-only button was announced as "✕" to a
      screen reader, because the accessible name comes from the glyph and never
      from `title`. (PR #70, live on run #37)
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
