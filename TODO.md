# TODO

The running state of this project. **Updated after every step** — see the
"Working agreement" in `CLAUDE.md`.

Last updated: 2026-08-07 · live: deploy run #33 (`5cd346e`)

---

## Live: German, and the copy-list change

**Both are deployed.** Deploy run #33 shipped the language switch on top of run
#32's copy-list change; every step passed, "Verify the public URL works"
included.

The whole interface now reads in **English or German**, switched from a picker
beside the theme toggle — so it is on both headers, on every signed-out screen
and on the guest share page, and needs no account. The choice is per device
(`localStorage`), exactly like the theme and for the same reasons: a guest has
nowhere to store a setting, and one person's phone is not another's laptop.
With nothing chosen, a German phone gets German on its own.

Three decisions worth knowing before touching it (`ARCHITECTURE.md` §9.1a):

- `web/src/strings.ts` is the whole dictionary, **one entry per string holding
  both languages** — the same shape as one `light-dark()` pair per colour, and
  TypeScript refuses a pair with a half missing, so German cannot fall behind.
- Entries are **whole sentences** with `{named}` placeholders, never fragments
  glued together at the call site. German does not put the verb where English
  does. `tx()` fills a placeholder with a `<Link>` or a `<strong>` so a sentence
  containing markup still stays one entry.
- Choosing German moves the **money and the dates** too, not only the words.
  German labels over `105.00` read as half-finished, and that is the half a
  dictionary alone leaves behind.

Three browser tests cover it, and the code was broken four times to watch each
one fail: the toggle removed from the guest header, removed from the signed-out
shell, the locale stopped following the language, and the pre-paint `<html lang>`
script deleted.

**What is NOT translated: anything the server says.** Emails all go out in
English, and so do the API's error messages, which the UI prints verbatim — so
a German page can still answer a bad password in English. Emails would need a
language stored per account rather than per device; the errors would need the
API to return codes instead of sentences. Say if either matters and they are
the next thing.

**German has been checked by hand on the live site and looks right** — which
is the only check that counts, since an agent sandbox cannot load it.

## Needs your hands

None of these can be done from an agent sandbox: the egress proxy refuses the
live domain by policy, so anything about the real site is yours.

- [ ] **Say if the notices are too much or too little.** Wording and who hears
      what are both easy to change; what is hard is noticing later that nobody
      reads them. `ARCHITECTURE.md` §4.1 has the table.
- [ ] **Say whether the emails should be German too.** They are the one part of
      the app that stays English, because the language lives on the device and
      the server has no idea which device is reading. Making them follow would
      mean storing a language on the account — worth doing only if the messages
      are actually being read.
- [ ] **Check the rest of the live site on a phone.** The Household page was
      checked on run #25, leaving a household on run #26, and password recovery
      on runs #27–#28 — all look right. What runs #17–#24 shipped still has
      not been: the new sign-up flow, the household switcher, "Make owner", and
      that your existing household looks untouched. A green deploy proves the
      URL responds, nothing more.

## Open work


- [ ] **The interface is bilingual; the server is not.** Emails and API error
      messages are English whoever is reading. The errors are the more visible
      of the two — they land in a German page's alert boxes — and fixing them
      means the API returning codes the frontend translates rather than
      sentences it prints. (§14)
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
