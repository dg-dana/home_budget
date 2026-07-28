# Deploying to Fly.io

The app is a single container: one Node process serving both the API and the
built frontend, with SQLite on an attached volume.

**The one rule that matters: run exactly one machine.** All state lives in a
file on the volume. A second machine would get its own volume and its own
diverging copy of your data, and nothing would warn you. Never
`fly scale count` above 1.

---

## Deploying from a browser (no terminal needed)

Everything below works on an iPad, a phone, or any machine where you would
rather not install anything. GitHub Actions runs `flyctl` on your behalf.

### 1. Create a Fly account

Sign up at [fly.io](https://fly.io). You will need to add a payment method —
Fly no longer has a free tier, and this app runs at roughly $2/month.

### 2. Create an access token

In the Fly dashboard: **Account → Access Tokens → Create token**. Copy the
value — it is shown once.

- **Name**: anything you will recognise later; it is only a label. `github-actions` works, since that is the only thing that uses it.
- **Expiry**: about a year is a sensible middle (some versions of the field want hours — 8760h). Shorter means rotating more often; longer means a long-lived credential sitting in your GitHub secrets.

Use a full account token, not an app-scoped deploy token: the first run has to
create the app, which an app-scoped token cannot do.

**When this token expires, the nightly backup stops as well as the deploy** —
they share it. GitHub emails you when a scheduled workflow fails, so you will
find out, but set a calendar reminder to rotate it if the expiry is short.

### 3. Give the token to GitHub

In this repository: **Settings → Secrets and variables → Actions → New
repository secret**.

- Name: `FLY_API_TOKEN`
- Value: the token you just copied

The nightly backup workflow uses the same secret, so this enables both.

### 4. Choose your app name and region

Edit `fly.toml` on GitHub — open the file and press the pencil icon, or press
`.` on the repository to get a full editor in the browser.

```toml
app = 'my-home-budget'      # must be globally unique
primary_region = 'ams'      # pick the one nearest you
```

Common regions: `ams` Amsterdam, `lhr` London, `fra` Frankfurt, `cdg` Paris,
`iad` Virginia, `lax` Los Angeles, `syd` Sydney, `nrt` Tokyo.

Commit the change.

### 5. Run the deploy

**Actions → Deploy to Fly.io → Run workflow.**

It typechecks, runs the test suite, then creates the app, the volume and the
session secret if they are missing, and deploys. When it finishes, the run
summary shows your URL: `https://<your-app>.fly.dev`.

Open it and create your household. The first account is the owner.

The workflow is safe to re-run — it never recreates the volume or rotates the
secret, so your data and everyone's sessions survive.

### Deploying again later

Same thing: **Actions → Deploy to Fly.io → Run workflow**. Deploys replace the
machine but not the volume, so the database is untouched. Migrations run
automatically on boot (`ARCHITECTURE.md` §3).

---

## Deploying from a terminal (alternative)

If you do have a machine with a shell:

```bash
curl -L https://fly.io/install.sh | sh     # or: brew install flyctl
fly auth login

fly apps create my-home-budget             # then set this name in fly.toml
fly volumes create data --size 1 --region ams --app my-home-budget
fly secrets set JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" --app my-home-budget
fly deploy
fly open
```

---

## Checking it worked

From a browser: the Fly dashboard shows the machine, its logs and its volume.
Look for `Applied N migration(s)` in the logs on the first boot, and confirm
there is exactly **one** machine.

From a terminal:

```bash
fly status                      # one machine, "started"
fly logs
fly ssh console -C "ls -la /data"
```

More than one machine means the split-brain risk described above — scale back
to 1 immediately.

---

## Backups

This is the part that actually matters. A lost provider account or a fumbled
command is recoverable from a backup; nothing else recovers your data.

### Take one on demand, from a browser

**Actions → Nightly backup → Run workflow.** It takes a snapshot and attaches
it to the run, so you can download the file from the run page.

### Take one from a terminal

```bash
fly ssh console -C "node /app/server/dist/backup.js"
```

This uses SQLite's online backup API, so it is safe while the app is serving
traffic. Copying the file with `cp` is **not** safe — in WAL mode you can get a
snapshot missing recent writes, or a corrupt one.

Snapshots land in `/data/backups/`, newest 14 kept (`BACKUP_KEEP` to change).

### Pull one down

```bash
fly ssh console -C "ls -1 /data/backups"
fly ssh sftp get /data/backups/home-budget-<timestamp>.sqlite ./restore.sqlite
```

A backup that only exists on the same volume as the original is not a backup.
Get a copy off the machine.

### Automatic daily off-site copies

`.github/workflows/backup.yml` runs a backup every night and stores it as a
GitHub artifact. It uses the same `FLY_API_TOKEN` secret as the deploy
workflow, so it starts working as soon as that is set — nothing else to do.

Artifacts expire after 90 days. Download one occasionally if you want a copy
that outlives that.

**GitHub pauses scheduled workflows after 60 days without repository
activity.** If you deploy this and then leave the repo alone for two months,
the nightly backup quietly stops until you open the Actions tab and re-enable
it. Nothing to do with Fly, but it affects the same safety net — so glance at
the Actions tab occasionally, or push a trivial commit now and then.

### Restore

**This currently needs a terminal.** If you only have a tablet or a phone,
that is a real gap: the nightly artifact gives you the data, but putting it
back requires `fly ssh`. Worth knowing before you need it — a
browser-driven restore workflow can be added if you want one.

```bash
fly ssh sftp shell
put ./restore.sqlite /data/restore.sqlite
exit

fly ssh console
  # inside the machine:
  mv /data/home-budget.sqlite /data/home-budget.sqlite.old
  mv /data/restore.sqlite /data/home-budget.sqlite
  exit

fly machine restart <machine-id>
```

Test this once before you need it.

---

## Costs

Measured requirements: ~85 MB peak memory, under 6 MB of data after ten years,
~30 MB/month of traffic. That fits the smallest machine with room to spare.

Roughly $2/month: a 256 MB `shared-cpu-1x` machine plus a 1 GB volume at
$0.15/GB. Bandwidth at this volume is effectively free.

To cut it further, let the machine sleep when idle — in `fly.toml`:

```toml
auto_stop_machines = 'stop'
min_machines_running = 0
```

Nothing is lost while stopped: recurring expenses materialise on read and catch
up on the next request (`ARCHITECTURE.md` §7). The trade is a 1–2 second cold
start on the first hit — including for a guest opening a share link.

---

## A custom domain (optional)

```bash
fly certs add budget.example.com
```

Then add the DNS records it prints. Fly handles the TLS certificate.

---

## Troubleshooting

**Boots then exits immediately.** Almost always a missing `JWT_SECRET` —
production refuses to start without one. Check `fly logs`.

**"database is locked".** More than one machine is writing. `fly status`, then
scale back to one.

**Everyone signed out after a deploy.** `JWT_SECRET` changed. Sessions are
JWTs, so the secret has to stay stable across deploys.

**Data gone after a deploy.** The volume was not mounted — check that
`[mounts] source` matches the volume name and that `DATABASE_PATH` points
inside `/data`.
