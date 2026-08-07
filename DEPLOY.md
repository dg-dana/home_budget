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
- [x] `RESEND_API_KEY` set in repository secrets — email live since run #24, and
      **a real message confirmed arriving** in a real inbox on run #27 (step 5)

Setup is complete; the app is live. What follows is the reference for doing it
again elsewhere, plus the everyday deploy, backup and restore procedures.

`/opt/home-budget/.env` holds `JWT_SECRET`. Never paste or screenshot the whole
file — read back single keys instead (`grep '^DOMAIN=' /opt/home-budget/.env`).
Leaking it means anyone can mint a session for any account.

Verified 2026-07-29: `home-budget-dg.app` resolves to `3.68.141.55` from both
Google and Cloudflare public resolvers — a single answer, and not a Cloudflare
edge address, which is what confirms the record is unproxied.

### Outage, 2026-07-30

Worth keeping, because both faults are the kind that recur.

The site stopped loading — a black screen that spun forever on a phone, no
error. Two separate problems, and the first deploy's green tick had told us
nothing about either, because its health check ran *inside* the app container.

**The instance was wedged.** All of 22, 80 and 443 timed out from outside while
DNS resolved correctly. A graceful **Stop** hung in "Stopping"; **Force stop**
followed by **Start** recovered it. Afterwards `dmesg` showed a real kill —
`Out of memory: Killed process (apt-check)` — on a box with 416 MB usable and
**no swap**. See "Memory headroom" under Costs; this will happen again
otherwise.

**Caddy was advertising HTTP/3 it could not serve.** `alt-svc: h3=":443"`
with a 30-day cache lifetime, while compose publishes TCP 443 only. Fixed by
pinning `protocols h1 h2`.

**It happened again on 2026-07-31**, roughly sixteen hours later and with the
same signature — DNS fine, 22, 80 and 443 all silent, another force stop to
recover. That second outage is what moved swap from "worth doing" to "do it
now". Within eight minutes of the reboot the box had already pushed 114 MB
into the new swap file, so the pressure is real and continuous, not a one-off
spike.

The database came through both force stops intact, checked by hand in the app
afterwards. That is what SQLite's WAL is for, but it is worth having observed
rather than assumed: two hypervisor-level power cuts, no corruption. A backup
taken between them passed `integrity_check` as well.

The OOM evidence for that night was lost with the restart — `dmesg` is
per-boot — so the theory that the 03:17 nightly backup triggers it is
plausible but unproven. Caddy's logs from just before the shutdown do show
Docker's embedded DNS resolver failing (`lookup ... on 127.0.0.11:53: server
misbehaving`), which is what a box in real distress looks like from the
inside.

The fix then failed to apply, silently, which is the part worth remembering:
`docker compose up -d` does not recreate a container whose service definition
is unchanged, and a bind-mounted Caddyfile's *contents* are not part of that
definition. The deploy copied the new file, Caddy never re-read it, and the
run went green. The deploy now reloads Caddy explicitly and checks the public
URL, so neither failure can pass silently again.

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
bash -c "$(curl -fsSL https://raw.githubusercontent.com/dg-dana/home_budget/HEAD/deploy/bootstrap.sh)"
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
| `RESEND_API_KEY` | *(optional)* turns email on — see below |

On an iPad, open the downloaded `.pem` in the Files app to copy its contents. If
it will not preview, rename it to end in `.txt`.

Never paste that key anywhere else — not into a chat, an issue, or a commit.
The whole point is that only GitHub and the server ever hold it.

#### The mail key

**`RESEND_API_KEY` is the only secret the app itself needs**, and the deploy
writes it into `/opt/home-budget/.env` on every run. Get one from
[resend.com](https://resend.com) after verifying the domain there; nothing else
is needed, because `MAIL_FROM` and `APP_URL` are derived from the `DOMAIN`
already in that file.

Without it the app still runs, and confirmation and invite links are shown on
screen for whoever is signed in to pass on — the way it worked before email
existed. **The one thing that stops working is "Forgotten your password?"**: it
is an unauthenticated page, so it refuses (503, "ask a household owner") rather
than printing a link anybody could use on any account they can name. If people
report that, check this secret first.

Turning it off again is deleting the repository secret and deploying: the step
rewrites that line every run, and an empty secret writes an empty value, which
the app reads as "no provider".

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

The deploy also copies `deploy/Caddyfile` and then **reloads Caddy explicitly**.
That reload is not decoration. `docker compose up -d` recreates a container only
when its *service definition* changes, and the Caddyfile is bind-mounted — its
contents are not part of that definition, so Compose leaves Caddy running and
Caddy never re-reads the file. Without the reload a Caddyfile change deploys
green and does nothing at all, which is exactly what happened on 2026-07-30.

The run is not finished until it has fetched the real public URL and got a 200.
A green deploy now means a visitor can load the site.

Rolling back means editing `APP_IMAGE=` in `/opt/home-budget/.env` to an
earlier tag and running `sudo docker compose up -d`. Every deploy is tagged
with its commit SHA.

---

## Checking on it

**Actions → Diagnose the deployment → Run workflow**, then read the run
summary. It needs no terminal, changes nothing, and works from a tablet.

It walks the path a visitor actually takes, from the outside in — DNS, port
443, port 80, the certificate, the HTTP response — and only then looks inside
the server at the containers, Caddy's logs, memory and disk. The summary ends
with a table mapping each failure to the thing that causes it.

Start here when the site will not load. The deploy workflow's own health check
runs *inside* the app container, so it can be green while the website is
unreachable; that is what the outside-in checks exist to catch, and why the
deploy now verifies the public URL too.

It reads the domain from the **domain** input if you fill one in, otherwise a
`DOMAIN` repository variable, and only then from the server's `.env`. Setting
the repository variable once (**Settings → Secrets and variables → Actions →
Variables**, name `DOMAIN`) means the outside-in checks still know what to look
for when the server is unreachable — which is exactly when you need them. It is
not a secret; it is the public name of the site.

The job goes green even when it finds faults. Red means the diagnostic itself
broke, not that your site is down — read the summary for the verdict.

For a closer look, through Lightsail's browser SSH:

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

### Memory headroom

The app's ~85 MB is not the whole story. The 512 MB bundle reports about
416 MB usable, and Docker, Caddy and the OS take most of what is left — the
instance sits near 110 MB free with **no swap configured**. On 2026-07-30 the
kernel OOM-killed a routine `apt-check`, and the instance wedged hard enough
that a graceful stop hung.

Nothing is wrong with the $5 bundle for this workload, but it has no cushion.

**Actions → Add swap to the instance → Run workflow.** It creates a 1 GB swap
file, persists it in `/etc/fstab`, sets `vm.swappiness=10` so swap is a last
resort rather than routine, and reads the result back over a fresh connection
to confirm. Nothing restarts and the site stays up. It is safe to re-run — it
skips whatever is already there.

`deploy/bootstrap.sh` does the same on a fresh server, so this workflow is only
needed for an instance that predates it.

Swap is a disk file, so it is far slower than RAM. It is not extra capacity;
it is the difference between "briefly slow" and "the OOM killer picks a
process and the box wedges".

If the diagnostic still shows memory pressure afterwards, move to the 1 GB
bundle ($7/month) in the Lightsail console — **Manage → Change plan**, which
requires a stop and start. Swap first: it is free, reversible, and `free -m` in
the diagnostic shows whether it was enough.

---

## Troubleshooting

Run **Actions → Diagnose the deployment** first — it identifies most of what
follows for you.

**The page never loads: no error, no content, just a blank screen that keeps
spinning.** A blank *hang* is different from an error. A 502, a bad certificate
or a 404 all put something on the screen; a hang means the reply never arrives
at all. Phones are usually affected before desktops.

The cause to suspect first is HTTP/3. Caddy enables it by default and
advertises `Alt-Svc: h3=":443"`, but `docker-compose.yml` publishes `443:443`,
which Docker takes as **TCP only**, and the Lightsail HTTPS rule is TCP too. So
the browser is told to switch to QUIC on UDP 443, and every packet it then
sends is dropped. It caches that instruction for a month, which is why the site
can work once and then stop. Browsers do fall back to TCP, but on a phone the
wait can be long enough to look like a hang.

`deploy/Caddyfile` now pins `protocols h1 h2`, so nothing unreachable is
advertised. If you are seeing this on a deployment from before that change,
redeploy and the `Alt-Svc` header goes away. A browser that already cached the
old advertisement needs its cache cleared, or simply time.

The diagnostic workflow reports any `Alt-Svc` header it sees, and the deploy
workflow now warns if one appears.

If it is not that, work down the diagnostic's reachability section: a hang with
port 443 closed is the firewall, and a hang with SSH also failing is the
instance itself — a 512 MB box can be pushed into swap death by something as
ordinary as an image build, which is why the image is built in CI.

### Enabling HTTP/3

Optional, and only worth it if you want the latency win on mobile. Both steps
are required — doing one without the other is exactly the blank-screen fault
above:

1. In `deploy/docker-compose.yml`, publish the UDP port alongside the TCP one:

   ```yaml
   ports:
     - '80:80'
     - '443:443'
     - '443:443/udp'
   ```

2. In the Lightsail **Networking → IPv4 Firewall**, add a **Custom / UDP / 443**
   rule.

Then drop the `protocols h1 h2` line from `deploy/Caddyfile` and redeploy.
Verify with the diagnostic workflow: an `Alt-Svc` header is only correct once
UDP 443 genuinely answers.

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

**"This site cannot send email, so it cannot reset a password by itself."**
That is `POST /auth/forgot` refusing because no mail provider is configured —
it will not print a recovery link on an unauthenticated page. Check the
`RESEND_API_KEY` repository secret exists and re-deploy; the deploy writes it
into `.env` every run. Confirm with
`grep -c '^RESEND_API_KEY=.' /opt/home-budget/.env` — `1` means set, `0` means
empty or absent. Until it is fixed, an owner can still issue a recovery link
from the Household page.

**Nothing is emailed but the app works fine.** Same cause, and everything
except the route above degrades to showing the link on screen, deliberately.
`sudo docker compose logs app | grep notifications` shows a
`[notifications] not sent (...)` line with the reason — never the address or
the link, which would be a credential sitting in the logs. A provider
answering `401` there is an expired or wrong key; `403` is usually a domain
that is not verified at Resend.

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
