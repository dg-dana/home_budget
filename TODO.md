# TODO

The running state of this project. **Updated after every step** — see the
"Working agreement" in `CLAUDE.md`.

Last updated: 2026-08-07 · live: deploy run #24 (`51ae836`)

---

## Waiting to be deployed

**Leaving a household without deleting your account** is merged and unshipped.
Nothing reaches the live site until somebody runs **Deploy to Lightsail** from
the Actions tab.

- `DELETE /household/members/me`, and "Leave this household" as the first thing
  in the Danger zone on `/household`. The owners are emailed that you left; you
  are not, since you did it.
- **No password on it**, alone in that card: a new invite undoes leaving, so
  asking for one would be friction aimed at the person with the least power in
  the household. Both deletions still ask.
- Refused in two cases, both of which would strand something — you are the
  **only owner** with other people still here (make someone else an owner
  first), or you are the **last person in it** (delete the household instead).
  Both are shown as disabled buttons with the reason underneath, rather than as
  a round trip that only produces an error.
- Leaving retires any recovery link an owner had outstanding for your account,
  exactly as being removed does.
- Ten new tests. Four deliberate breaks were watched to fail, the route
  ordering among them: `/members/me` has to be matched before `/members/:id`,
  which is owner-only — reversed, the route 403s every member it exists for.
- The page was looked at in a browser as a member and as an owner, in both
  themes and at both widths, and the leave itself was driven through a real
  click: the confirm, the redirect to the picker, and the household gone from
  it.

## Also now: check a real message arrives

Email is **live** — PR #32 shipped it (run #20), and PRs #33 and #34 sorted
out the confirmation screen (runs #21 and #22), all green through "Verify the
public URL works". A real invite arriving in a real inbox is still unconfirmed, and an
agent sandbox cannot reach the site, so that check is yours.

### Your part

1. **Send yourself an invite to a real address and confirm it arrives.**
   Household page → Email → Create invite. **Check the spam folder** — a brand
   new sending domain often lands there for the first few messages.
2. **Say if any of the notices are too much or too little.** Wording and who
   hears what are both easy to change; what is hard is noticing later that
   nobody reads them.
3. If nothing arrives, look at **Resend → Emails**: a message listed as
   delivered is a mail problem, no message listed at all is a key problem
   (the app logs `[notifications] not sent (...)` and falls back to showing
   the link, so nothing breaks either way).

### What was built

- `notifications.ts` posts to Resend over one `fetch` — no SDK. Every message
  in the app goes through it: confirmation, invites, recovery.
- **No key configured behaves exactly as before**, link on screen. That is
  what lets the suite and local development run, and stops an expired key
  locking anyone out. A send never throws.
- `MAIL_FROM` and `APP_URL` default off `DOMAIN`, so production needed one
  secret and nothing else. Both can be pinned in `.env` to override.
- Twenty-one new tests across `notifications.test.ts` (no provider) and
  `notificationsSending.test.ts` (provider configured, only the provider
  intercepted) — the suite never makes a real request. Four deliberate breaks
  were watched to fail.
- Invites and recovery now travel through `notifications.ts` as well, so
  there is finally *one* place deciding how a message is sent.
- **The app now emails what has happened, not only what needs a link**:
  somebody joining, being removed, a role change, a household renamed, a
  household or an account deleted, a password changed. `ARCHITECTURE.md` §4.1
  has the full table of who hears what. The person who did it is not told,
  except for closing a household or their own account; routine edits —
  expenses, lists, categories — send nothing on purpose.

### Fixed alongside it

- **An account with no household can now delete itself**, from `/households`.
  The "Danger zone" lives on the Household page, which needs a household open,
  so an account that had left its only household — or never joined one — was
  stuck with an account it could not close. Covered by a browser test.

### Follow-ups since it went live

- **The confirmation screen no longer shows the link when the email went out**
  (live, run #21).
  It said "Sent to you" *and* printed the link, which reads as a failure and
  leaves a working credential on screen. Now it is a plain "we have emailed
  you", and a message that never arrives is answered by **"send the
  confirmation link again"** rather than by showing the link.

- **An invitation now shows on `/households`** and can be joined there (live,
  run #24). Found
  on the live site: the invited person registered from the invite email,
  landed on the picker, and had no way to reach the invite except finding the
  message again. Open invites (no address on them) stay link-only.

### Still open on email

- **Self-service "forgot password"** is now possible and does not exist yet.
  Recovery is still owner-issued (§14).
- The word **"verification"** is fair on the live deployment now, but not on
  an unconfigured one — anywhere without a key, the link is handed straight
  to whoever registered.

## Also needs your hands

- [x] ~~**GitHub stopped creating Actions runs mid-session**~~ — **it came back
      on its own.** Pushes after 15:27 UTC on 2026-08-06 produced no CI run at
      all, which is why PR #35 was merged on a local run of typecheck and both
      suites rather than on CI. The push for PR #37 the next morning created
      two `verify` runs and both passed, so nothing needs changing in the
      Actions or billing settings. Nobody found out what it was; if it goes
      quiet again, that is the thing to say.

- [ ] **Check the live site on a phone.** Runs #17–#24 have never been looked
      at by a human. A green deploy proves the URL responds, nothing more.
      Worth checking: the new sign-up flow, the household switcher, "Make
      owner", and that your existing household looks untouched.

## Open work

- [ ] **Owner-issued recovery still grants a whole account**, which may span
      households. Removing someone retires their links, which closes the
      obvious abuse, but a self-service "forgot password" would remove the need
      for the feature — and email sending has now unblocked it. (§14)
- [ ] **Member list page does not poll**, the guest one does every 15 s — so a
      member can read a stale list while a guest shops. (§14)

## Done

- [x] Leave a household without deleting your account — "Leave this household"
      in the Danger zone, `DELETE /household/members/me`. (merged, **not
      deployed**)
- [x] Email sends through Resend, and the app also emails what has happened —
      joins, removals, role changes, renames, both deletions, password
      changes. Plus "Delete account" on `/households`, and invitations listed
      on the picker. (live, runs #20–#24, not yet confirmed by hand)
- [x] Delete an account / delete a household — "Danger zone" (live, run #16,
      confirmed on a phone)
- [x] Accounts separate from households; several per account; per-household
      display name; email confirmation flow (live, run #17)
- [x] Switcher reachable with only one household — was a dead end (live, run #18)
- [x] Promote a member to owner / demote back — "Make owner" on the Household
      page. Never your own role, which is what keeps an owner in every
      household. (live, run #19)
