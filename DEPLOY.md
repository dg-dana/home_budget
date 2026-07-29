# Deploying to AWS Lightsail

One small server running two containers: the app, and Caddy in front of it
terminating TLS. The database is a SQLite file on the server's disk.

Everything after the initial setup runs from the GitHub Actions tab — deploys,
backups and restores — so no terminal is needed day to day.

**HTTPS is not optional here.** The app marks its session cookies `Secure` in
production, so over plain HTTP nobody could sign in. That is why there is a
domain and a reverse proxy rather than just an IP address.

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
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<branch>/deploy/bootstrap.sh | bash
```

If the repository is private, open `deploy/bootstrap.sh` on GitHub, copy it,
and paste it into the terminal instead.

It installs Docker, creates `/opt/home-budget`, asks for your domain and
generates the session secret. It is safe to re-run; it will not regenerate a
secret that already exists.

Give it the hostname alone — `home-budget-dg.app`, no `https://`, no trailing
slash. It goes into the Caddyfile verbatim, and Caddy requests a certificate
for exactly that name.

### 4. Point DNS at the server

In the Cloudflare dashboard, pick the domain, then **DNS → Records → Add
record**:

| Field | Value |
| --- | --- |
| Type | `A` |
| Name | `@` (the bare domain — `home-budget-dg.app` itself) |
| IPv4 address | the static IP from step 2 |
| Proxy status | **DNS only** — click the orange cloud so it turns grey |
| TTL | Auto |

**The grey cloud is the part that matters.** Cloudflare's proxy is on by
default, and leaving it on breaks this setup in three separate ways:

- **The certificate.** Proxied, Cloudflare answers TLS with its own certificate and Caddy's ACME challenge is intercepted. Combined with Cloudflare's default "Flexible" SSL mode — which speaks plain HTTP to the origin, while Caddy redirects plain HTTP to HTTPS — you get a redirect loop instead of a site.
- **Rate limiting.** The app trusts exactly one proxy hop (`app.set('trust proxy', 1)` in `server/src/app.ts`) and keys its limiter on the resulting IP. Add Cloudflare in front and that resolves to a Cloudflare edge address, not the visitor — so one person fumbling their password locks out everyone else sharing that edge.
- **Debugging.** Two proxies means twice the places a 502 can come from.

DNS-only costs nothing here. The app serves ~30 MB a month from a box that is
already idle; there is no load to shed and no cache to warm.

Nothing else needs adding — no `www`, no `CNAME`, no Cloudflare SSL/TLS setting,
because with the proxy off Cloudflare is only answering DNS queries.

Wait for it to resolve before deploying. Caddy asks Let's Encrypt to verify the
domain, and that fails if DNS has not propagated yet. Cloudflare is usually
quick — under a minute. Check from the Lightsail browser SSH with
`dig +short home-budget-dg.app`; it should print the static IP and nothing else.

### 5. Give GitHub access to the server

Download the SSH key: Lightsail console → **Account → SSH keys → Download** the
default key for your region. It downloads as a `.pem` file.

In this repository, **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
| --- | --- |
| `LIGHTSAIL_HOST` | the static IP |
| `LIGHTSAIL_SSH_KEY` | the entire contents of the `.pem` file, including the `-----BEGIN` and `-----END` lines |
| `LIGHTSAIL_USER` | *(optional)* login user, defaults to `ubuntu` |

On an iPad, open the downloaded `.pem` in the Files app to copy its contents.

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
