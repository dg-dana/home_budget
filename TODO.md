# TODO

The running state of this project. **Updated after every step** — see the
"Working agreement" in `CLAUDE.md`.

Last updated: 2026-08-07 · live: deploy run #26 (`977724d`)

---

## Next: deploy self-service "forgot password"

**Built, tested and on the branch — not deployed.** Nothing more to write; the
next step is yours, and it is two clicks: merge, then run **Deploy to
Lightsail** from the Actions tab. Merging alone changes nothing on the live
site.

What shipped in the code:

- `POST /auth/forgot` — unauthenticated, takes an address, emails a recovery
  link if that address has an account. Answers `202 {"ok":true}` either way.
- `/forgot` on the frontend, linked from the sign-in page where the sentence
  telling people to ask an owner used to be. Also linked from the "link not
  usable" state of `/reset/:token`.
- `issuePasswordReset()` moved into `auth.ts`, so owner-issued and self-service
  links are minted by one function and retire each other. No migration —
  `created_by` was nullable already.

The four decisions, as settled:

1. **It never reveals whether an address has an account.** Same status, same
   body, same wording. A test asserts the two responses are equal rather than
   asserting each separately, because that is the property that matters.
2. **Five requests per hour per address**, on top of the existing 60 / 15 min
   per IP. The limiter grew a `key` option to do it; a bystander's address in
   the test proves the bucket is the address, not the IP.
3. **No mail provider means the route refuses** — 503, "ask a household owner
   to send you a reset link". Showing the link the way every other flow does
   would let anybody into any account by typing its address. So on a laptop or
   in the suite this route is off unless `RESEND_API_KEY` is set.
4. **It retires outstanding links**, owner-issued ones included.

One thing knowingly left open: an address with an account takes as long as the
provider does to answer and one without answers immediately, so the *timing*
still distinguishes them. Closing it means replying before sending, which costs
the suite its only way to check what was sent. The per-address budget is the
defence. It is written down in `ARCHITECTURE.md` §14 rather than quietly
ignored.

**Worth doing next, and now merely a decision:** owner-issued recovery has lost
its reason to exist (an owner can reset the password of an account that belongs
to households they have never heard of). It is still the only recovery an
unconfigured deployment has, so it cannot simply be deleted — say the word and
it goes.

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
- [ ] **Try "Forgotten your password?" on the live site once it is deployed.**
      The whole flow depends on a message actually arriving, which no agent can
      check from here — and it is the same open question as the invite above.
      Sign-in page → Forgotten your password? → your own address. Expect the
      "Check your email" screen whatever you type, including an address that
      has no account: that is the feature working, not a failure.
- [ ] **Check the rest of the live site on a phone.** The Household page was
      checked on run #25 and leaving a household on run #26 — both look right.
      What runs #17–#24 shipped still has not been: the new sign-up flow, the
      household switcher, "Make owner", and that your existing household looks
      untouched. A green deploy proves the URL responds, nothing more.

## Open work

- [ ] **Owner-issued recovery grants a whole account**, which may span
      households. Removing someone retires their links, which closes the
      obvious abuse, but an owner can still reset the password of an account
      that belongs to households they have never heard of. Self-service now
      exists, so the feature has lost its reason — except on a deployment with
      no mail provider, where it is the only recovery there is. Retiring it is
      a decision, not a task. (§14)
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

- [x] Self-service "forgot password" — `POST /auth/forgot` and the `/forgot`
      page, linked from sign-in. Same answer whether or not the address exists,
      the link only ever in the email, 5 requests an hour per address, and a
      refusal rather than a fallback when nothing can send mail. **On the
      branch, not deployed** — see the top of this file. (`ARCHITECTURE.md` §4)
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
