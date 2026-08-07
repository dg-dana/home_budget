# TODO

The running state of this project. **Updated after every step** — see the
"Working agreement" in `CLAUDE.md`.

Last updated: 2026-08-07 · live: deploy run #26 (`977724d`)

---

## Next: self-service "forgot password"

The next thing to build, and the last real gap email sending opened up.
Recovery today is **owner-issued only**: a locked-out member has to ask an
owner to mint them a link (`POST /household/members/:id/reset-password`). That
is fine until the person locked out *is* the owner, or the household has one
owner who is on a plane.

### What already exists

Half the flow is built and live — only the *request* half is missing.

- `password_resets` — token, `user_id`, `expires_at`, `used_at`, and
  **`created_by` which is already nullable**, so a link nobody issued needs no
  migration. Single-use, 24 hours (`config.passwordResetMaxAgeMs`).
- `GET /auth/reset/:token` — public preview, returns the address so the page
  can greet the right person and nothing else.
- `POST /auth/reset` — public redemption. Sets the password, burns the token,
  signs the person in, emails them that it happened, and bumps
  `session_generation` so every older session dies (§4).
- `/reset/:token` on the frontend, and `deliver()` in `notifications.ts` with
  `passwordResetNotice` already written.

### What is missing

One unauthenticated route — roughly `POST /auth/forgot` taking an address —
plus a link to it from the sign-in page. Four decisions to make before writing
it, none of them settled:

1. **Never say whether the address exists.** The same 202 and the same on-screen
   wording either way, or the endpoint becomes a way to enumerate who has an
   account. This is the one that is easy to get wrong and impossible to
   un-ship.
2. **Rate limiting.** `/api/auth` is already behind 60 requests / 15 min per IP
   (`app.ts`), which is generous for this route — a tighter per-address limit
   is worth considering, given each request sends mail.
3. **What an unconfigured deployment does.** With no `RESEND_API_KEY` a send is
   dropped, so a self-service link would go nowhere and the person would be
   stuck with no feedback. Options: refuse the route when no provider is
   configured and say so, or keep owner-issued recovery as the documented
   fallback. Do not print the link on screen — that would hand anybody a way
   into any account by typing its address.
4. **Whether it retires outstanding links**, the way issuing a new one already
   does. Probably yes, same one-liner.

Then the usual: cases in `auth.test.ts` and `notificationsSending.test.ts`
(the address that does not exist must produce *no* mail and the same
response), break it once and watch it fail, and `ARCHITECTURE.md` §4 + §14 —
where "recovery is still owner-issued" is currently listed as a rough edge.

## Needs your hands

None of these can be done from an agent sandbox: the egress proxy refuses the
live domain by policy, so anything about the real site is yours.

- [ ] **Send yourself a real invite and check it arrives.** Email is live (runs
      #20–#24) but no message has been seen landing in a real inbox. Household
      page → Create invite with your address. **Check spam** — a new sending
      domain often lands there for the first few. If nothing comes, look at
      **Resend → Emails**: a message listed as delivered is a mail problem, no
      message listed at all is a key problem. Either way nothing breaks — with
      no key the app logs `[notifications] not sent (...)` and falls back to
      showing the link.
- [ ] **Say if the notices are too much or too little.** Wording and who hears
      what are both easy to change; what is hard is noticing later that nobody
      reads them. `ARCHITECTURE.md` §4.1 has the table.
- [ ] **Check the rest of the live site on a phone.** The Household page was
      checked on run #25 and leaving a household on run #26 — both look right.
      What runs #17–#24 shipped still has not been: the new sign-up flow, the
      household switcher, "Make owner", and that your existing household looks
      untouched. A green deploy proves the URL responds, nothing more.

## Open work

- [ ] **Owner-issued recovery grants a whole account**, which may span
      households — the reason "Next" above is worth doing. Removing someone
      retires their links, which closes the obvious abuse, but an owner can
      still reset the password of an account that belongs to households they
      have never heard of. Self-service would remove the need for the feature
      altogether. (§14)
- [ ] **Member list page does not poll**, the guest one does every 15 s — so a
      member can read a stale list while a guest shops. (§14)
- [ ] **"Verification" means less on an unconfigured deployment.** With no
      `RESEND_API_KEY` the confirmation link is handed straight to whoever
      registered, so it is a step in the flow rather than a check. Right trade
      for the suite and local work; worth remembering before relying on
      "confirmed" as proof of anything. (§14)

## Done

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
      opened the link again. (live, runs #20–#24 — **no message has been seen
      arriving in a real inbox yet**, which is the first item under "Needs
      your hands")
- [x] Delete an account / delete a household — "Danger zone" (live, run #16,
      confirmed on a phone)
- [x] Accounts separate from households; several per account; per-household
      display name; email confirmation flow (live, run #17)
- [x] Switcher reachable with only one household — was a dead end (live, run #18)
- [x] Promote a member to owner / demote back — "Make owner" on the Household
      page. Never your own role, which is what keeps an owner in every
      household. (live, run #19)
