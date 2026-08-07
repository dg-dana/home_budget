# TODO

The running state of this project. **Updated after every step** — see the
"Working agreement" in `CLAUDE.md`.

Last updated: 2026-08-07 · live: deploy run #28 (`96264c0`)

---

## Next: your call

Nothing is queued. Owner-issued recovery went out retired on deploy run #28
(PR #47) — on the live site the "Reset password" button is gone from the
Household page and the route answers 403, because anybody locked out can help
themselves now. It survives only where nothing can send email.

One candidate, not started:

- **Make the member list page poll.** A member can sit reading a stale shopping
  list while a guest shops the same one; the guest page already refetches every
  15 s. The fix is either the same interval on the member page or moving both
  to something pushed. (§14)

Worth a look when someone has a phone: the Household page since run #28, to see
that the members card reads sensibly without the button — the line replacing it
says where to reset a password instead.

## Needs your hands

None of these can be done from an agent sandbox: the egress proxy refuses the
live domain by policy, so anything about the real site is yours.

- [ ] **Send yourself a real invite and check it arrives.** Lower stakes than it
      was: the reset email from run #27 arrived, so the provider, `MAIL_FROM`
      and `APP_URL` are all proven. What an invite would add is that the *other*
      messages travel too. Household page → Create invite with your address.
      **Check spam** — a new sending domain often lands there for the first few.
- [ ] **Say if the notices are too much or too little.** Wording and who hears
      what are both easy to change; what is hard is noticing later that nobody
      reads them. `ARCHITECTURE.md` §4.1 has the table.
- [ ] **Check the rest of the live site on a phone.** The Household page was
      checked on run #25 and leaving a household on run #26 — both look right.
      What runs #17–#24 shipped still has not been: the new sign-up flow, the
      household switcher, "Make owner", and that your existing household looks
      untouched. A green deploy proves the URL responds, nothing more.

## Open work

- [ ] **An owner still reaches any account in their household where email is
      unconfigured.** What was the general case is now the exception: with a
      mail provider the route is refused. Without one it stays, because the
      alternative is a locked-out member with no way back in. The fix is
      configuring email, which is one secret. (§14)
- [ ] **`POST /auth/forgot` is quiet about existence but not about timing** —
      an address with an account waits for the provider, one without answers
      at once. The per-address budget is what makes that useless in practice.
      (§14)
- [ ] **Member list page does not poll**, the guest one does every 15 s — so a
      member can read a stale list while a guest shops. (§14)
- [ ] **"Verification" means less on an unconfigured deployment.** With no
      `RESEND_API_KEY` the confirmation link is handed straight to whoever
      registered, so it is a step in the flow rather than a check. Right trade
      for the suite and local work; worth remembering before relying on
      "confirmed" as proof of anything. (§14)

## Done

- [x] **Owner-issued recovery retired to a fallback** — refused (403) wherever
      email is configured, button hidden, `ownerRecovery` in the session
      payload telling the frontend which world it is in. Still working where
      nothing can send email, because there it is the only way back in. Both UI
      states were looked at in a browser rather than reasoned about. (PR #47,
      live on run #28 — **not checked by hand on the real site yet**)
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
