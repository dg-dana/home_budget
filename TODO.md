# TODO

The running state of this project. **Updated after every step** — see the
"Working agreement" in `CLAUDE.md`.

Last updated: 2026-08-04 · live: deploy run #19 (`97d2610`)

---

## Now: make email actually send

**This is the blocker, and Resend is the chosen provider.** Nothing in this app
has ever sent an email — invites, password recovery and the address confirmation
added in run #17 all put a link **on screen** for whoever is signed in to pass on
by hand. That is how it has always worked (`ARCHITECTURE.md` §14), not a
regression, but it is now what stands in the way.

**Workaround meanwhile:** adding someone already works. Create the invite on the
Household page, press **Copy**, send the link over WhatsApp. They open it,
register, and they are in.

### Step 1 — the human part (an agent cannot do any of this)

1. Sign up at **resend.com** (free tier is ~3,000 messages a month; a household
   will use a handful).
2. **Domains → Add Domain →** `home-budget-dg.app`.
3. Resend shows a set of **DNS records** (SPF and DKIM, both TXT; possibly a
   DMARC one). Add each in **Cloudflare** for that domain, then press Verify in
   Resend. Without these, mail either lands in spam or is rejected.
4. **API Keys → Create**, sending permission is enough.
5. Put it in **GitHub → Settings → Secrets and variables → Actions → New
   repository secret**, named `RESEND_API_KEY`.
6. Say in chat that it is done, and which **from** address you want. Suggestion:
   `Home Budget <noreply@home-budget-dg.app>` — it must be on the verified
   domain or Resend refuses to send.

### Step 2 — the agent part

Ordered, and each piece is small:

1. **`server/src/config.ts`** — read `RESEND_API_KEY` and `MAIL_FROM`. Both
   optional; absent means "no provider", which must stay a supported state.
2. **`server/src/notifications.ts`** — teach `deliver()` to POST to
   `https://api.resend.com/emails`. **It is the only function that changes**;
   every caller is already ignorant of how a message travels, which is why that
   module exists. No SDK needed — one `fetch` with a Bearer token.
3. **Keep the on-screen link as the fallback.** With no key configured the app
   must behave exactly as it does today. That is what lets the test suite and
   local development run without a provider, and what stops an expired key
   locking everybody out of inviting anyone. Log a warning, never throw.
4. **Route invites and password recovery through `notifications.ts` too.** Today
   they return their link straight to the owner and never touch that module, so
   there is not yet *one* place deciding how a message travels. Both keep
   returning the link as well — an owner may still want to hand it over.
5. **Plumbing for the secret**, three files:
   - `deploy/docker-compose.yml` — add `RESEND_API_KEY` and `MAIL_FROM` to the
     app service's `environment:` block, like `JWT_SECRET`.
   - `deploy/bootstrap.sh` — add both to the generated `.env` template.
   - `.github/workflows/deploy.yml` — write the secret into the server's `.env`
     on each deploy, the same `sed -i '/^KEY=/d'` + `echo` shape already used
     for `APP_IMAGE` (around line 136). Do **not** echo the value into logs.
6. **Tests.** Sending must not become a thing the suite depends on: assert that
   with no key the notice still comes back with its link (today's behaviour),
   and that with a key configured `deliver()` calls the provider — with `fetch`
   stubbed, never a real request. Then break it once and watch it fail.
7. **Only once this is live** may confirmation be called **verification**
   anywhere user-facing. Until an address has actually received something, it
   proves nothing.

### After it is deployed

Send yourself an invite to a real address and confirm it arrives — and check the
spam folder, since a brand new sending domain often lands there for the first
few messages.

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
