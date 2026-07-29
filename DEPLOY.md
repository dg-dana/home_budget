# Deploying to AWS Lightsail

One small server running two containers: the app, and Caddy in front of it
terminating TLS. The database is a SQLite file on the server's disk.

Everything after the initial setup runs from the GitHub Actions tab — deploys,
backups and restores — so no terminal is needed day to day.

**HTTPS is not optional here.** The app marks its session cookies `Secure` in
production, so over plain HTTP nobody could sign in. That is why there is a
domain and a reverse proxy rather than just an IP address.

---

## This deployment

The live instance, so nobody has to rediscover it:

| | |
| --- | --- |
| Domain | `home-budget-dg.app` |
| Registrar / DNS | Cloudflare |
| Host | AWS Lightsail, `eu-central-1` (Frankfurt) |
| Static IP | `3.68.141.55` |
| Instance | Ubuntu 22.04 LTS, 512 MB bundle ($5/month) |
| App directory | `/opt/home-budget` |

The static IP is public information — it is what the domain resolves to. It
lives in the `LIGHTSAIL_HOST` secret because the deploy workflow needs it, not
because it is confidential.

### Where the setup got to

- [x] Instance created and running
- [x] Static IP attached
- [x] Firewall open on 22, 80 and 443
- [x] `LIGHTSAIL_HOST` and `LIGHTSAIL_SSH_KEY` set in repository secrets
- [x] Domain registered (`home-budget-dg.app`, Cloudflare)
- [x] Nameservers live — `penny.ns.cloudflare.com`, `renan.ns.cloudflare.com`
- [x] **A record → `3.68.141.55`, DNS only** (step 4)
- [x] `bootstrap.sh` run on the instance — `.env` written with `DOMAIN` and `JWT_SECRET` (step 3)
- [x] First deploy — run #1, all steps green, health check passed (step 6)

Setup is complete; the app is live. What follows is the reference for doing it
again elsewhere, plus the everyday deploy, backup and restore procedures.

`/opt/home-budget/.env` holds `JWT_SECRET`. Never paste or screenshot the whole
file — read back single keys instead (`grep '^DOMAIN=' /opt/home-budget/.env`).
Leaking it means anyone can mint a session for any account.

Verified 2026-07-29: `home-budget-dg.app` resolves to `3.68.141.55` from both
Google and Cloudflare public resolvers — a single answer, and not a Cloudflare
edge address, which is what confirms the record is unproxied.

**Until this branch is merged**, take `bootstrap.sh` from this branch, not from
the default branch — the default branch still has the version whose prompt
cannot read your answer:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/dg-dana/home_budget/refs/heads/claude/cloudflare-next-steps-01wjoz/deploy/bootstrap.sh)"
```

---

## First-time setup

### 1. Buy a domain and decide the hostname

Anything works — `budget.example.com`, or the bare domain. You will point it at
the server in step 4.

This deployment uses **`home-budget-dg.app`**, registered at Cloudflare, on the
bare domain. Step 4 is written for that; substitute freely.

Two things follow from the `.app` TLD. It is on the browsers' HSTS preload
list, so `http://` is never tried — there is no plain-HTTP fallback to limp
along on if the certificate fails. And Caddy still needs port 80 reachable for
the ACME challenge even though no traffic is ever served on it.

### 2. Create the Lightsail instance

In the [Lightsail console](https://lightsail.aws.amazon.com):

- **Create instance**
- Platform: **Linux/Unix**, blueprint: **OS Only → Ubuntu 22.04 LTS**
- Plan: the **$5/month** one is the sensible floor. The app needs ~85 MB of RAM, but the OS and Docker want headroom.
- Name it, then **Create instance**

Then two things people forget:

- **Networking → Attach a static IP.** Without this the address changes when the instance restarts, and your DNS silently points at nothing.
- **Networking → IPv4 Firewall → Add rule → HTTPS (443).** Port 80 is usually open by default; 443 usually is not. Caddy needs both — 80 for the certificate challenge, 443 to serve.

### 3. Run the bootstrap script

Lightsail has a browser SSH client — the **Connect using SSH** button on the
instance page. It works on an iPad. Click it and run:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/dg-dana/home_budget/refs/heads/claude/expenses-shopping-app-4bmukm/deploy/bootstrap.sh)"
```

Copy that shape exactly. The more familiar `curl ... | bash` does not work
here: it hands bash the script on standard input, so the domain prompt reads
the script's own next line instead of what you type.

If the repository is ever made private, open `deploy/bootstrap.sh` on GitHub,
copy it, and paste it into the terminal instead.

It installs Docker, creates `/opt/home-budget`, asks for your domain and
generates the session secret. It is safe to re-run; it will not regenerate a
secret that already exists.

Give it the hostname alone — `home-budget-dg.app`, no `https://`, no trailing
slash. It goes into the Caddyfile verbatim, and Caddy requests a certificate
for exactly that name.

### 4. Point DNS at the server

DNS for this domain is on Cloudflare. In the dashboard, pick
`home-budget-dg.app`, then **DNS → Records → Add record**:

| Field | Value |
| --- | --- |
| Type | `A` |
| Name | `@` (the bare domain — for a subdomain, a label like `budget` instead) |
| IPv4 address | `3.68.141.55` |
| Proxy status | **DNS only** — click the orange cloud so it turns grey |
| TTL | Auto |

Delete anything already sitting on that name. New domains often ship with a
parking record or a URL forward, and it will win over the record you just
added.

#### The grey cloud is the part that matters

Cloudflare's proxy is on by default, and leaving it on breaks this setup three
separate ways:

- **The certificate.** Proxied, Cloudflare terminates TLS with its own certificate and Caddy never sees the Let's Encrypt challenge it needs to answer. Combined with Cloudflare's default *Flexible* SSL mode — which speaks plain HTTP to an origin that redirects plain HTTP to HTTPS — you get an infinite redirect loop instead of a site.
- **Rate limiting.** The app trusts exactly one proxy hop (`app.set('trust proxy', 1)` in `server/src/app.ts`) and keys its limiter on the resulting IP. Add Cloudflare in front and that resolves to a Cloudflare edge address, not the visitor — so one person fumbling their password locks out everyone else sharing that edge.
- **Debugging.** Two proxies means twice the places a 502 can come from.

Grey cloud avoids all three: traffic goes straight to the instance and Caddy
handles TLS, as the rest of this document assumes. It costs nothing here — the
app serves ~30 MB a month from a box that is already idle, so there is no load
to shed and no cache to warm.

Nothing else needs adding: no `www`, no `CNAME`, and no Cloudflare SSL/TLS
setting, because with the proxy off Cloudflare only answers DNS queries.

(If you ever do want the proxy in front, the certificate has to be working
first, its SSL mode must be **Full (strict)**, and the hop count in the app has
to be fixed. Not a toggle — see `ARCHITECTURE.md` §11.)

#### A note on `.app`

The `.app` TLD is HSTS-preloaded: browsers refuse plain HTTP to it, always.
There is no `http://` fallback for testing, so the site simply will not load
until Caddy has its certificate. That is expected, not a fault. Let's Encrypt's
own challenge still works, because it is not a browser. Caddy does still need
port 80 reachable for that challenge, even though no traffic is ever served on
it.

#### Check it before deploying

Caddy asks Let's Encrypt to verify the domain, and that fails if DNS has not
propagated yet. Cloudflare is usually quick — under a minute.

From the Lightsail browser SSH:

```bash
dig +short home-budget-dg.app
```

It should print `3.68.141.55`, one line, nothing else. Several unfamiliar
addresses means the record is still proxied. No output at all means the record
is not there yet. [dnschecker.org](https://dnschecker.org) does the same job
from a phone.

### 5. Give GitHub access to the server

GitHub needs a private key that the instance trusts. Two ways to get one; the
second is easier on a tablet and gives a better key.

**Either** download Lightsail's default key. It is under **More ▾ → Account →
SSH keys** — the top-right dropdown, *not* the hamburger menu, which only lists
resources. Direct link:
[lightsail.aws.amazon.com/ls/webapp/account/keys](https://lightsail.aws.amazon.com/ls/webapp/account/keys).
That page has two sections: ignore **Custom keys** (those buttons make a *new*
key the instance does not trust) and take the one under **Default keys**. Check
the region matches the instance. It downloads as a `.pem`.

**Or** generate a key on the server, through Lightsail's browser SSH:

```bash
ssh-keygen -t ed25519 -f ~/deploy_key -N "" -C github-actions
cat ~/deploy_key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
cat ~/deploy_key          # paste this into the GitHub secret
rm ~/deploy_key           # once the secret is saved
```

This avoids downloading a file at all, and the result is a key that exists only
for deploys: revoking it is deleting its line from `~/.ssh/authorized_keys`,
which leaves your own console access alone. Newer AWS accounts may have no
default key to download anyway.

Then, in this repository, **Settings → Secrets and variables → Actions**
([direct link](https://github.com/dg-dana/home_budget/settings/secrets/actions)),
add:

| Secret | Value |
| --- | --- |
| `LIGHTSAIL_HOST` | the static IP (here: `3.68.141.55`) |
| `LIGHTSAIL_SSH_KEY` | the whole key text, including the `-----BEGIN` and `-----END` lines |
| `LIGHTSAIL_USER` | *(optional)* login user, defaults to `ubuntu` |

On an iPad, open the downloaded `.pem` in the Files app to copy its contents. If
it will not preview, rename it to end in `.txt`.

Never paste that key anywhere else — not into a chat, an issue, or a commit.
The whole point is that only GitHub and the server ever hold it.

### 6. Deploy

**Actions → Deploy to Lightsail → Run workflow.**

It typechecks, runs the tests, builds the image, pushes it to the GitHub
container registry, then tells the server to pull and restart. The run summary
shows your URL when it finishes.

The first deploy takes a minute longer than later ones while Caddy obtains the
certificate. If `https://` does not work immediately, give it sixty seconds.

Open the site and create your household — the first account is the owner.

---

## Everyday deploys

**Actions → Deploy to Lightsail → Run workflow.** The image is rebuilt and
swapped; the `data/` directory is untouched, so the database survives.
Migrations run automatically on boot (`ARCHITECTURE.md` §3).

Rolling back means editing `APP_IMAGE=` in `/opt/home-budget/.env` to an
earlier tag and running `sudo docker compose up -d`. Every deploy is tagged
with its commit SHA.

---

## Checking on it

Through Lightsail's browser SSH:

```bash
cd /opt/home-budget
sudo docker compose ps          # both containers "running"
sudo docker compose logs app    # look for "Applied N migration(s)" on first boot
sudo docker compose logs caddy  # certificate problems show up here
ls -la data/                    # the database and its backups
```

---

## Backups

The part that matters more than the hosting choice. Hardware fails and commands
get fumbled; a backup is the only thing that recovers from either.

### Automatic

`.github/workflows/backup.yml` runs nightly, takes a snapshot, verifies it with
`PRAGMA integrity_check`, and uploads it as a GitHub artifact — a copy that
lives somewhere other than the server's disk. It uses the same secrets as the
deploy workflow, so it starts working as soon as those are set.

Artifacts expire after 90 days. Download one occasionally if you want a copy
that outlives that.

**GitHub pauses scheduled workflows after 60 days without repository
activity.** If you deploy and then leave the repo alone for two months, the
nightly backup quietly stops until you open the Actions tab and re-enable it.
Glance at it occasionally.

### On demand

**Actions → Nightly backup → Run workflow.** Download the file from the run page.

### How it works

`server/src/backup.ts` uses SQLite's online backup API, not a file copy. In WAL
mode a plain `cp` can capture the main database without its matching WAL
contents — a snapshot silently missing recent writes, or corrupt outright. The
backup API cooperates with the running database and always produces a valid
file, so it is safe while the app is serving traffic.

Snapshots stay in `data/backups/` on the server too, newest 14 kept
(`BACKUP_KEEP` to change).

### Restore

**Actions → Restore from a backup → Run workflow.** It wants:

- **run_id** — the numeric ID from the URL of the backup run holding the snapshot
- **confirm** — type `CONFIRM`

It verifies the snapshot before touching anything, stops the app, moves the
current database aside as `data/home-budget.replaced-<timestamp>.sqlite`, swaps
the backup in and restarts. The database it replaced stays on the server, so a
mistaken restore is itself recoverable.

**Try this once while nothing is wrong.** A restore path you have never
exercised is a guess.

---

## Costs

Measured requirements: ~85 MB peak memory, under 6 MB of data after ten years,
~30 MB of traffic a month.

The $5/month Lightsail bundle covers all of it, including 1 TB of transfer —
roughly 30,000 times what this app uses. That is the whole bill; unlike metered
providers there is nothing else to add up. A domain is about $10–15 a year.

---

## Troubleshooting

**No certificate / the browser warns.** Caddy could not complete the Let's
Encrypt challenge. Check that the A record resolves to the static IP and that
port 443 is open in the Lightsail firewall. `sudo docker compose logs caddy`
gives the reason.

**A redirect loop, or a certificate issued to Cloudflare rather than
Let's Encrypt.** The record is proxied — orange cloud. Set it to **DNS only**
in the Cloudflare DNS tab and give it a minute, then restart Caddy with
`sudo docker compose restart caddy`. On `.app` this is total: the browser
refuses plain HTTP, so a failed certificate means no site at all, not a site
with a warning.

**`dig` shows an IP you do not recognise.** Same cause — those are Cloudflare
edge addresses, which is what a proxied record returns. `dig +short
home-budget-dg.app` should return the Lightsail static IP, one line, nothing
else.

**Rate limits firing for people who did nothing.** Also the proxy: with
Cloudflare in front, every visitor arrives from a handful of edge IPs, and the
limiter cannot tell them apart. Turning the proxy off restores real client
addresses.

**The app container restarts in a loop.** Usually a missing `JWT_SECRET` —
production refuses to boot without one. Check `/opt/home-budget/.env` and
`sudo docker compose logs app`.

**Everyone signed out after a deploy.** `JWT_SECRET` changed. Sessions are
JWTs, so it has to stay stable; the bootstrap script deliberately will not
regenerate it.

**Deploy workflow cannot connect.** `LIGHTSAIL_SSH_KEY` must contain the whole
`.pem`, `-----BEGIN`/`-----END` lines included. Confirm `LIGHTSAIL_HOST` is the
static IP, not the earlier dynamic one.

**Site unreachable after a restart.** The static IP was probably never attached
in step 2.

**"At least one source IP address or Lightsail service must be configured"**
when adding the firewall rule. The rule's source box is empty. Leave it as **Any
IP address** (`0.0.0.0/0`) — a public web server has to accept connections from
anyone. The restriction field is for locking down SSH, not HTTPS.

---

## Why not Fly.io

Fly was the original target and is a good fit technically — the Dockerfile came
from that work. It was abandoned for an account-level reason, not a technical
one: Fly refuses to issue API tokens to any account that belongs to an
organization requiring SSO, and fails silently when you try. Without a token
there is no way to deploy from CI.

If that ever clears up, the app itself needs no changes to move back.

---

## Moving somewhere else

Nothing here is specific to AWS. The app reads four environment variables,
depends on no cloud SDK, and hardcodes no provider hostname. Moving to another
VPS is: run `bootstrap.sh` on the new box, restore the newest backup, repoint
DNS. The Dockerfile, compose file and Caddyfile come along unchanged; only the
host in the GitHub secrets changes.
