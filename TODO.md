# TODO

The running state of this project. **Updated after every step** — see the
"Working agreement" in `CLAUDE.md`.

Last updated: 2026-08-06 · live: deploy run #19 (`97d2610`)

---

## Now: deploy the email change and check a message arrives

Email **sends** — the code is written, tested and on
`claude/resend-instructions-oyye37`; it is not live yet.

### Your part

1. **Deploy to Lightsail** from the Actions tab, once the branch is merged.
   Nothing else has to be set on the server: the deploy writes
   `RESEND_API_KEY` into `/opt/home-budget/.env` from the repository secret,
   and the sending address and link base derive from `DOMAIN`.
2. **Send yourself an invite to a real address and confirm it arrives.**
   Household page → Email → Create invite. **Check the spam folder** — a brand
   new sending domain often lands there for the first few messages.
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
- Nine new tests (`server/test/notifications.test.ts`), `fetch` stubbed —
  the suite never makes a real request. Both halves were broken once and
  watched to fail.
- Invites and recovery now travel through `notifications.ts` as well, so
  there is finally *one* place deciding how a message is sent.

### Still open on email

- **Self-service "forgot password"** is now possible and does not exist yet.
  Recovery is still owner-issued (§14).
- The word **"verification"** is fair on the live deployment now, but not on
  an unconfigured one — anywhere without a key, the link is handed straight
  to whoever registered.

## Also needs your hands

- [ ] **Check the live site on a phone.** Runs #17–#19 have never been looked
      at by a human. A green deploy proves the URL responds, nothing more.
      Worth checking: the new sign-up flow, the household switcher, "Make
      owner", and that your existing household looks untouched.

## Open work

- [ ] **Leave a household without deleting your account.** An owner can remove
      anyone but themselves, so a member who wants out has to ask.
      `DELETE /household/members/me`. (§14)
- [ ] **Owner-issued recovery still grants a whole account**, which may span
      households. Removing someone retires their links, which closes the
      obvious abuse, but a self-service "forgot password" would remove the need
      for the feature — and email sending has now unblocked it. (§14)
- [ ] **Member list page does not poll**, the guest one does every 15 s — so a
      member can read a stale list while a guest shops. (§14)

## Done

- [x] Delete an account / delete a household — "Danger zone" (live, run #16,
      confirmed on a phone)
- [x] Accounts separate from households; several per account; per-household
      display name; email confirmation flow (live, run #17)
- [x] Switcher reachable with only one household — was a dead end (live, run #18)
- [x] Promote a member to owner / demote back — "Make owner" on the Household
      page. Never your own role, which is what keeps an owner in every
      household. (live, run #19)
