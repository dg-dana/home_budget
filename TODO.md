# TODO

The running state of this project. **Updated after every step** — see the
"Working agreement" in `CLAUDE.md`.

Last updated: 2026-08-03 · live: deploy run #18 (`e6d5304`)

---

## Needs your hands

Things no agent can do — an agent sandbox cannot load the live site.

- [ ] **Check the live site on a phone.** Runs #17 and #18 have never been
      looked at by a human. A green deploy proves the URL responds, nothing
      more. Worth checking: the new sign-up flow, the household switcher, and
      that your existing household looks untouched.
- [ ] **Open a Resend account** (or say which provider) if you want real
      emails. Needs one DNS record. Until then confirmation links are shown on
      screen and prove nothing.

## Open work

- [ ] **Promote an existing member to owner.** No route exists; a role is fixed
      when the membership is created. "Hand ownership over first" currently
      means inviting a *new* owner. `PUT /household/members/:id/role`.
      (`ARCHITECTURE.md` §14)
- [ ] **Leave a household without deleting your account.** An owner can remove
      anyone but themselves, so a member who wants out has to ask.
      `DELETE /household/members/me`. (§14)
- [ ] **Send email for real.** `deliver()` in `server/src/notifications.ts` is
      the only function that changes. Until it does, do not call confirmation
      "verification" anywhere user-facing.
- [ ] **Owner-issued recovery still grants a whole account**, which may span
      households. Removing someone retires their links, which closes the
      obvious abuse, but a self-service "forgot password" would remove the need
      for the feature. (§14)
- [ ] **Member list page does not poll**, the guest one does every 15 s — so a
      member can read a stale list while a guest shops. (§14)

## Done

- [x] Delete an account / delete a household — "Danger zone" (live, run #16,
      confirmed on a phone)
- [x] Accounts separate from households; several per account; per-household
      display name; email confirmation flow (live, run #17)
- [x] Switcher reachable with only one household — was a dead end (live, run #18)
