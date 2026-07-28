# Deploying to Fly.io

The app is a single container: one Node process serving both the API and the
built frontend, with SQLite on an attached volume.

**The one rule that matters: run exactly one machine.** All state lives in a
file on the volume. A second machine would get its own volume and its own
diverging copy of your data, and nothing would warn you. Never
`fly scale count` above 1.

---

## First deploy

### 1. Install flyctl and sign in

```bash
curl -L https://fly.io/install.sh | sh     # or: brew install flyctl
fly auth signup                            # or: fly auth login
```

### 2. Create the app

Pick a globally unique name, then put it in `fly.toml`.

```bash
fly apps create my-home-budget
```

Edit `fly.toml`:

```toml
app = 'my-home-budget'
primary_region = 'ams'      # pick the region nearest you: fly platform regions
```

### 3. Create the volume

The database lives here and survives deploys and restarts. 1 GB is far more
than enough — a decade of data measured at under 6 MB.

```bash
fly volumes create data --size 1 --region ams --app my-home-budget
```

The name `data` must match `[mounts] source` in `fly.toml`.

### 4. Set the session secret

The app **refuses to boot** in production without this, on purpose.

```bash
fly secrets set JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" --app my-home-budget
```

Keep it stable. Changing it signs everyone out, since sessions are JWTs.

### 5. Deploy

```bash
fly deploy
fly open
```

Create your household on the sign-up page. That first account is the owner.

---

## Checking it worked

```bash
fly status                      # one machine, "started"
fly logs                        # look for "Applied N migration(s)" on first boot
fly ssh console -C "ls -la /data"
```

`fly status` showing more than one machine means the split-brain risk above —
scale back to 1 immediately.

---

## Everyday deploys

```bash
git push          # CI runs typecheck and both test suites
fly deploy        # after CI is green
```

Deploys replace the machine but not the volume, so the database is untouched.
Migrations run automatically on boot; see `ARCHITECTURE.md` §3.

---

## Backups

This is the part that actually matters. A lost provider account or a fumbled
command is recoverable from a backup; nothing else recovers your data.

### Take one by hand

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
GitHub artifact. To enable it:

```bash
fly tokens create deploy --app my-home-budget      # copy the output
```

Add it as a repository secret named `FLY_API_TOKEN`
(Settings → Secrets and variables → Actions).

Artifacts expire after 90 days, so download one occasionally if you want
something permanent.

### Restore

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
