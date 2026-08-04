# TODO

The running state of this project. **Updated after every step** — see the
"Working agreement" in `CLAUDE.md`.

Last updated: 2026-08-04 · live: deploy run #19 (`97d2610`)

---

## Now: make email actually send

**This is the blocker.** Nothing in the app has ever sent an email — not
invites, not password recovery, and not the address confirmation added in run
#17. Every one of them puts a link **on screen** for whoever is signed in to
pass on by hand. That is not a regression; it is how the app has always worked
(`ARCHITECTURE.md` §14), and it is now the thing standing in the way.

**Workaround while this is being built:** adding someone still works. Create the
invite on the Household page, press **Copy**, and send the link over WhatsApp or
a text message. They open it, register, and they are in.

### What is needed from you (an agent cannot do these)

1. **Choose a provider.** Recommendation: **Resend** — free tier is ~3,000
   messages a month, far more than a household will send, and setup is one
   dashboard plus DNS.
2. **Create the account** and add the sending domain `home-budget-dg.app`.
3. **Add the DNS records it gives you** in Cloudflare (SPF and DKIM, both TXT).
   Without these, mail from the domain lands in spam or is rejected outright.
4. **Put the API key in GitHub → Settings → Secrets → Actions** as
   `RESEND_API_KEY`. Say when it is there.

### What the agent then does

- Teach `deliver()` in `server/src/notifications.ts` to send. **It is the only
  function that changes** — every caller is already ignorant of how a message
  travels, which is the whole point of that module existing.
- Add `RESEND_API_KEY` and `MAIL_FROM` to `config.ts`, to the `environment:`
  block in `deploy/docker-compose.yml`, and to the `.env` template in
  `deploy/bootstrap.sh`. The deploy workflow will need to write the key into
  the server's `.env`, the same way `APP_IMAGE` is rewritten.
- **Keep the on-screen link as the fallback.** With no key configured the app
  must behave exactly as it does today rather than failing to invite anyone —
  that is what makes local development and the test suite work without a
  provider, and what stops a lapsed API key locking everybody out.
- Three messages become real, and they already exist as notices:
  **confirm your address**, **you are invited to a household**, and
  **password recovery**. Invites and recovery currently return their link to
  the *owner* rather than going through `notifications.ts` — they need routing
  through it, so there is still one place that decides how a message travels.
- Only once this is live may confirmation be called **verification** anywhere
  user-facing. Until an address has actually received something, it proves
  nothing.

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
      for the feature — and becomes possible the moment email sends. (§14)
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
