# pantry-pal Production Runbook

Operational procedures for `https://pantry.thirion.org`: first setup, routine deploys, admin accounts, rollback, and a tested restore of a provider backup.

The site is deployed with the shared `hetzner-deploy` tool (checked out at `C:\Users\xbox\dev\hetzner-deploy`). Its manifest is `sites/pantry-pal.json` in that repository, not in this one. The design is in `.github/memorybank/features/shopping-lists-mvp/design.md` (Deployment section).

## Human checkpoints

Production deployment, account creation with real credentials, and backup restore are human-checkpoint operations. They are never run by tests, scripts, or agents, and nobody has run them as part of writing this runbook. An operator runs each one only after the approval listed here.

| Checkpoint | Operation                            | Approval needed before starting                                                                                           |
| ---------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| CP1        | `deploy.ps1 -Site pantry-pal -Setup` | Local validation passed, DNS and server access confirmed, `.env` created on the server by the operator (see First setup). |
| CP2        | Accepting the deployment as ready    | `.env` ownership and mode verified, health, redirect, and header checks passed.                                           |
| CP3        | Creating the household and two users | The service is healthy and the household admin has approved real-account setup.                                           |
| CP4        | Phone sign-in and PWA install        | Both users exist; each account holder is present with their own phone.                                                    |
| CP5        | Provider backup restore test         | Maintenance window approved, provider backup selected, and a separate verified copy of the live database confirmed.       |

Secrets and passwords:

- Never put a secret or password in a command argument, chat message, ticket, pull request, log, or file in a repository.
- `BETTER_AUTH_SECRET` is generated on the server and never displayed. Do not `cat`, `less`, `echo`, or paste `/opt/pantry-pal/shared/.env`.
- Passwords are typed only at the hidden prompt of the admin CLI.
- Evidence records hold pass/fail, timestamps, checksums, and table counts only; never row values, emails, password hashes, or session values.

## Prerequisites

Operator workstation (Windows):

- Windows PowerShell 5.1 or PowerShell 7, with `ssh`, `scp`, `tar`, and `curl.exe` on the PATH.
- The pantry-pal checkout at `C:\Users\xbox\dev\pantry-pal` on the commit to deploy, with Node.js 22 (see `.nvmrc`) and `npm ci` already run. The tool builds from the working tree, so uncommitted changes are deployed too; deploy from a clean `main`.
- The hetzner-deploy checkout with `sites/pantry-pal.json` merged.
- An ssh config alias for the deploy user (default `hetzner`, or `HETZNER_DEPLOY_TARGET`) and one for root, shown below as `<root-alias>` (for example `hetzner-root`). See the hetzner-deploy README for the alias format.

Server (already provisioned for the other sites): Ubuntu with nginx, certbot, systemd, and Node.js 22 at `/usr/bin/node`; port `3100` free on localhost; a DNS `A`/`AAAA` record for `pantry.thirion.org` pointing at it.

Server layout once set up:

| Path                               | Purpose                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `/opt/pantry-pal/releases/<id>`    | One folder per deploy (`<id>` is a `YYYYMMDD-HHMMSS` timestamp).   |
| `/opt/pantry-pal/current`          | Symlink to the live release.                                       |
| `/opt/pantry-pal/shared/pantry.db` | The SQLite database (plus `pantry.db-wal` and `pantry.db-shm`).    |
| `/opt/pantry-pal/shared/.env`      | Runtime secrets, created by the operator on the server.            |
| `/opt/pantry-pal/shared/backups/`  | Database copies the tool takes before each deploy and rollback.    |
| `pantry-pal.service`               | systemd unit running as the `pantry-pal` user on `127.0.0.1:3100`. |

## Local validation (no server contact)

Run these before any production step. They read files only.

In the hetzner-deploy checkout:

```powershell
Invoke-Pester -Path tests
```

The `pantry-pal site manifest` tests check the node-systemd and database settings and require the exact approved `install` command, which includes `--ignore-scripts`. `better-sqlite3` 13 bundles its prebuilt binaries, but the server's npm 10 would otherwise run `node-gyp rebuild` and fail because no compiler is installed. Re-check this if `better-sqlite3` is upgraded or another dependency needs an install script.

In the pantry-pal checkout:

```powershell
npm run build
```

## First setup and deploy (CP1)

Approval required: CP1. All commands in this section change the production server.

1. Confirm DNS for `pantry.thirion.org` resolves to the server and the root ssh alias works.
2. Create the runtime configuration on the server, as root, before the first deploy. The tool refuses to deploy while `/opt/pantry-pal/shared/.env` is missing, and the file cannot belong to group `pantry-pal` until setup creates that user, so create it root-only now and fix the group in step 4:

   ```powershell
   ssh -t <root-alias>
   ```

   On the server:

   ```bash
   install -d -m 0750 -o root -g root /opt/pantry-pal/shared
   install -m 0600 -o root -g root /dev/null /opt/pantry-pal/shared/.env
   echo 'BETTER_AUTH_URL=https://pantry.thirion.org' >> /opt/pantry-pal/shared/.env
   openssl rand -hex 32 | sed 's/^/BETTER_AUTH_SECRET=/' >> /opt/pantry-pal/shared/.env
   ```

   The secret goes straight from `openssl` into the file; it is not displayed, typed, or stored in shell history. `BETTER_AUTH_URL` must equal the manifest's `PUBLIC_ORIGIN`, or the service refuses to start. The file holds plain `KEY=value` lines with no quotes.

3. From the workstation, set up and deploy:

   ```powershell
   C:\Users\xbox\dev\hetzner-deploy\bin\deploy.ps1 -Site pantry-pal -Setup
   ```

This direct `-Site` command does not show the interactive menu's confirmation prompt. CP1 approval must be obtained before invoking it. It creates the `pantry-pal` user and unit, the nginx site and certificate, then builds, uploads, activates the release, and checks `/api/health` (there is no database to back up on the first deploy). If the health check fails the tool switches back; read the printed log excerpt and do not continue.

4. On the server, give the service group read access and verify, without displaying contents:

   ```bash
   chmod 0750 /opt/pantry-pal/shared
   chgrp pantry-pal /opt/pantry-pal/shared/.env
   chmod 0640 /opt/pantry-pal/shared/.env
   stat -c '%U:%G %a' /opt/pantry-pal/shared /opt/pantry-pal/shared/.env
   sudo -u pantry-pal test -r /opt/pantry-pal/shared/.env && echo "service user can read"
   sudo -u nobody test -r /opt/pantry-pal/shared/.env || echo "other users cannot read"
   grep -c '^BETTER_AUTH_URL=https://pantry.thirion.org$' /opt/pantry-pal/shared/.env
   awk -F= '$1=="BETTER_AUTH_SECRET" { print (length($0) - length($1) - 1 >= 32) ? "secret length ok" : "secret too short" }' /opt/pantry-pal/shared/.env
   systemctl is-active pantry-pal
   ```

Expected: `pantry-pal:pantry-pal 750` for the shared directory, `root:pantry-pal 640` for `.env`, `service user can read`, `other users cannot read`, `1`, `secret length ok`, and `active`. Anything else blocks CP2. The private directory prevents other local users from traversing to database files or backups, including while a restored DB retains its original file mode.

5. Run the checks in [Verify health, HTTPS, and headers](#verify-health-https-and-headers).

If `-Setup` reaches the deploy phase and stops at `Missing /opt/pantry-pal/shared/.env`, no release was activated, but setup may already have created the service user, unit, nginx site, or certificate. Do not assume the server was left unchanged. Create the file as in step 2, verify the existing setup state, then run a plain deploy (next section) and continue at step 4.

## Routine deploy

Approval required before invocation: the direct `-Site` command does not show the interactive menu's confirmation prompt. This changes the production server.

```powershell
C:\Users\xbox\dev\hetzner-deploy\bin\deploy.ps1 -Site pantry-pal
```

The tool builds locally and uploads the new release. On the server it validates the service user and `.env`, then runs `npm ci` in the new release while the current service remains available. After installation, it fixes release permissions, stops the service, and copies the database to `shared/backups/<release id>.db` (with `-wal` and `-shm` when present) immediately before switching `current` and restarting. It then polls `/api/health`. If health fails and the expected backup exists, the tool restores the database and code before restarting the service. If the expected database backup is missing, it stops the service, switches code back when a prior release exists, and exits without restarting; investigate and verify database recovery before starting it. The tool keeps the last 5 database backups and the last 3 releases. The database does not change on a deploy unless a new migration runs at startup.

Inspect releases and history:

```powershell
C:\Users\xbox\dev\hetzner-deploy\bin\deploy.ps1 -Site pantry-pal -List
C:\Users\xbox\dev\hetzner-deploy\bin\status.ps1
```

Then run the health, redirect, and header checks below.

## Verify health, HTTPS, and headers

These checks send unauthenticated requests and expose no secrets. Run them from the workstation after any deploy, rollback, or restore.

Health returns `200` with `{"status":"ok"}`:

```powershell
curl.exe -sS -w "`nHTTP %{http_code}`n" https://pantry.thirion.org/api/health
```

HTTP redirects to HTTPS:

```powershell
$h = (curl.exe -sS -D - -o NUL http://pantry.thirion.org/) -join "`n"
[pscustomobject]@{
    Redirect = [bool]($h -match '(?m)^HTTP/\S+ 30[1278]')
    ToHttps  = [bool]($h -match '(?im)^location:\s*https://pantry\.thirion\.org')
}
```

HTTPS responses carry the required headers, on the health endpoint and on the app document:

```powershell
foreach ($url in 'https://pantry.thirion.org/api/health', 'https://pantry.thirion.org/') {
    $h = (curl.exe -sS -D - -o NUL $url) -join "`n"
    [pscustomobject]@{
        Url      = $url
        Status   = [bool]($h -match '(?m)^HTTP/\S+ 200')
        Hsts     = [bool]($h -match '(?im)^strict-transport-security:.*max-age=[1-9]\d*')
        Csp      = [bool]($h -match "(?im)^content-security-policy:.*default-src 'self'")
        Nosniff  = [bool]($h -match '(?im)^x-content-type-options:\s*nosniff\s*$')
        Referrer = [bool]($h -match '(?im)^referrer-policy:\s*\S+')
    }
}
```

Every value must be `True`. A missing header, a redirect that does not target `https://`, or a non-redirecting HTTP response fails the check; fix it and run the checks again before accepting the deployment (CP2). No exact HSTS duration or `Referrer-Policy` value is prescribed; HSTS needs a positive `max-age` and the policy must be non-empty.

Before publishing anything, confirm no secrets are tracked in this repository:

```powershell
git ls-files | Select-String -Pattern '(^|/)\.env'
```

This prints nothing.

## Admin commands

Approval required: CP3 for real accounts. The admin CLI runs on the server as the `pantry-pal` user, never as root: a root-run command can create root-owned `-wal` and `-shm` files that the service cannot use.

Open a root session and define a helper for the session. It adds `PUBLIC_ORIGIN` because the CLI validates `BETTER_AUTH_URL` from `.env` against it, and `NODE_ENV=production` so the CLI checks the same configuration as the service:

```powershell
ssh -t <root-alias>
```

```bash
cd /opt/pantry-pal/shared
pp_admin() {
  sudo -u pantry-pal env \
    NODE_ENV=production \
    DB_PATH=/opt/pantry-pal/shared/pantry.db \
    PUBLIC_ORIGIN=https://pantry.thirion.org \
    /usr/bin/node --env-file=/opt/pantry-pal/shared/.env \
    /opt/pantry-pal/current/src/pantry-pal/dist/cli.js "$@"
}
```

Commands (the service can keep running):

| Command                                                                           | Effect                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pp_admin household:create --name "<name>"`                                       | Creates a household and prints its id.                                          |
| `pp_admin user:create --email <email> --name "<name>" --household <household-id>` | Creates a user in the household. Prompts for the password and its confirmation. |
| `pp_admin user:reset-password --email <email>`                                    | Prompts for a new password and revokes that user's sessions.                    |
| `pp_admin maintenance:daily`                                                      | Runs the tombstone purge the API also runs daily at 03:30 UTC.                  |

There is no password option. The prompt is hidden and needs a terminal, so connect with `ssh -t`. Passwords must be 8 to 128 characters in the CLI's prompt policy; if a password is rejected, the CLI prints the accepted length range. Never type a password anywhere else.

### Create the household and two users (CP3)

1. `pp_admin household:create --name "<household name>"` and note the printed id.
2. `pp_admin user:create --email <first email> --name "<first name>" --household <household-id>`; the account holder types the password at the prompt.
3. Repeat for the second user, with the same household id. The second account holder may enter their password at a separate supervised session.
4. Confirm membership with counts only (read-only query as the service user):

   ```bash
   sudo -u pantry-pal /usr/bin/node -e '
   const Database = require("/opt/pantry-pal/current/node_modules/better-sqlite3");
   const db = new Database("/opt/pantry-pal/shared/pantry.db", { readonly: true, fileMustExist: true });
   console.log(db.prepare("SELECT (SELECT COUNT(*) FROM household) AS households, (SELECT COUNT(*) FROM user) AS users, (SELECT COUNT(*) FROM household_member) AS members, (SELECT COUNT(DISTINCT household_id) FROM household_member) AS member_households").get());
   '
   ```

   Expected: `households: 1, users: 2, members: 2, member_households: 1`.

### Sign in and install on phones (CP4)

Each account holder opens `https://pantry.thirion.org` on their own phone, signs in, adds the app to the home screen (Chrome on Android, Safari on iOS 16.4 or later), launches it from the icon, and sees the household's lists. Record pass or fail per user. If a check fails, onboarding is incomplete: fix the cause (for example `user:reset-password`) and repeat. Do not record passwords or session values.

## Rollback

Approval required: operator decision. These commands change the production server.

```powershell
C:\Users\xbox\dev\hetzner-deploy\bin\deploy.ps1 -Site pantry-pal -List
C:\Users\xbox\dev\hetzner-deploy\bin\deploy.ps1 -Site pantry-pal -Rollback
C:\Users\xbox\dev\hetzner-deploy\bin\deploy.ps1 -Site pantry-pal -Rollback -Release <release id>
C:\Users\xbox\dev\hetzner-deploy\bin\deploy.ps1 -Site pantry-pal -Rollback -SkipDbRestore
```

- `-Rollback` switches to the previous release (or the release given with `-Release`) and also restores the database from the backup taken when the release after the target was deployed, which is the data as it was just before that release. Everything written since that deploy is lost. The direct `-Site` command does not show the interactive menu's confirmation prompt; obtain the operator's explicit approval before invoking it.
- Before restoring, the tool saves the current database as `shared/backups/pre-rollback-<timestamp>.db` (with `-wal` and `-shm` when present). Confirm the data-loss decision before running the command.
- `-Rollback -SkipDbRestore` rolls back the code only and keeps the current database. Use it when the data is fine. Migrations are not reversed, and the older code starts against the newer schema; check that the release you roll back to predates no migration in `src/pantry-pal/drizzle/` that the older code cannot read.
- If the needed backup was already pruned (only the last 5 are kept), the rollback stops before changing anything; use `-SkipDbRestore` or the provider restore below.

After a rollback, run the health, redirect, and header checks.

## Restore a provider backup (CP5)

Purpose: prove that a daily provider backup of `pantry.db` can be restored and read correctly, without losing live data. The service is stopped for the whole procedure and the live database is put back before it restarts. The provider backup never remains the live database.

Approval required before starting:

- The household agreed to a short maintenance window. The service is unavailable during it; the PWA keeps working offline and syncs afterwards.
- A provider backup is selected and its timestamp recorded (`<backup timestamp>`).
- You understand that every command below runs on the production server as root.

Do not start the service on the restored backup data. Starting it runs migrations and the maintenance purge, which change the files and can delete rows, and would make the equivalence checks meaningless. Everything is verified from the stopped files.

### 1. Prepare the session

```powershell
ssh -t <root-alias>
```

On the server:

```bash
S=/opt/pantry-pal/shared
W=/root/pantry-restore-$(date -u +%Y%m%d-%H%M%S)
install -d -m 0700 "$W" "$W/live" "$W/backup"
echo "$W"
df -h /opt /root
```

Keep this shell open; `$S` and `$W` are used throughout. If it closes, set them again (reuse the printed `$W`).

Define the helpers. `sums` prints SHA-256 checksums of the database and WAL plus the presence of the shm file. `put` replaces the live files with the set in a folder, removing all three live files first so a stale WAL can never pair with a different database file:

```bash
sums() { ( cd "$1" && for f in pantry.db pantry.db-wal; do if [ -f "$f" ]; then sha256sum "$f"; else echo "absent  $f"; fi; done; if [ -f pantry.db-shm ]; then echo "present  pantry.db-shm"; else echo "absent  pantry.db-shm"; fi ); }
put() {
  rm -f "$S/pantry.db" "$S/pantry.db-wal" "$S/pantry.db-shm"
  for f in pantry.db pantry.db-wal pantry.db-shm; do
    if [ -f "$1/$f" ]; then cp -p "$1/$f" "$S/$f" && chown pantry-pal:pantry-pal "$S/$f"; fi
  done
}
```

Create the read-only verifier. It copies the files to a private scratch folder and opens that copy read-only, so the files under test are never modified. It prints integrity, foreign-key, table-count, and counter results, never row values:

```bash
cat > "$W/verify.cjs" <<'EOF'
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('/opt/pantry-pal/current/node_modules/better-sqlite3');

const source = process.argv[2];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-verify-'));
let pass = false;
try {
  for (const file of ['pantry.db', 'pantry.db-wal']) {
    const from = path.join(source, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(scratch, file));
  }
  const db = new Database(path.join(scratch, 'pantry.db'), {
    readonly: true,
    fileMustExist: true,
  });
  const integrity = db.pragma('integrity_check').map((r) => r.integrity_check);
  const fkRows = db.pragma('foreign_key_check').length;
  console.log(`integrity_check=${integrity.join(';')}`);
  console.log(`foreign_key_check_rows=${fkRows}`);
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  for (const { name } of tables) {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    console.log(`rows.${name}=${db.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get().n}`);
  }
  const counter = db.prepare('SELECT value FROM change_counter WHERE id = 1').get();
  console.log(`change_counter.value=${counter ? counter.value : 'missing'}`);
  db.close();
  pass = integrity.length === 1 && integrity[0] === 'ok' && fkRows === 0 && Boolean(counter);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log(`RESULT=${pass ? 'PASS' : 'FAIL'}`);
process.exitCode = pass ? 0 : 1;
EOF
```

### 2. Stop the service and preserve the live database

```bash
systemctl stop pantry-pal
systemctl is-active pantry-pal
```

The second command must print `inactive`. While stopped, nginx returns an error page. Do not continue if the service is still active.

Preserve the live database with its sidecars. A stopped service can leave `pantry.db-wal` and `pantry.db-shm` behind (the process does not close the database on shutdown), and they hold committed data, so they are part of the database:

```bash
stat -c '%a %U:%G %n' "$S"/pantry.db* | tee "$W/live.modes"
for f in pantry.db pantry.db-wal pantry.db-shm; do
  if [ -f "$S/$f" ]; then cp -p "$S/$f" "$W/live/$f"; fi
done
sums "$S" > "$W/live.source.sums"
sums "$W/live" > "$W/live.copy.sums"
diff "$W/live.source.sums" "$W/live.copy.sums" && echo "PASS: preserved checksums match" || echo "FAIL: preserved checksums differ"
node "$W/verify.cjs" "$S" > "$W/live.source.report"
node "$W/verify.cjs" "$W/live" > "$W/live.copy.report"
cat "$W/live.source.report"
diff "$W/live.source.report" "$W/live.copy.report" && echo "PASS: preserved summary matches" || echo "FAIL: preserved summary differs"
```

Stop here (leave the service stopped and go to [Failure recovery](#failure-recovery)) unless both `PASS` lines print and `RESULT=PASS` appears in `live.source.report`.

Create the second, off-server copy and confirm it is identical. The database holds personal data, so use an encrypted or access-restricted local folder. On the workstation:

```powershell
  scp -r "<root-alias>:/root/pantry-restore-<stamp>/live" "<secure local folder>"
  scp "<root-alias>:/root/pantry-restore-<stamp>/live.source.sums" "<secure local folder>\live.source.sums"
  $local = "<secure local folder>\live"
  Get-FileHash "$local\pantry.db" -Algorithm SHA256
  if (Test-Path "$local\pantry.db-wal") { Get-FileHash "$local\pantry.db-wal" -Algorithm SHA256 } else { 'absent  pantry.db-wal' }
  if (Test-Path "$local\pantry.db-shm") { 'present  pantry.db-shm' } else { 'absent  pantry.db-shm' }
```

Compare the `pantry.db` and `pantry.db-wal` hashes and the `pantry.db-wal`/`pantry.db-shm` presence lines to the matching entries in the copied `live.source.sums`; every applicable hash and presence value must match. Confirm both copies exist before continuing. This is the CP5 live-copy confirmation.

### 3. Stage and verify the provider backup

Obtain `pantry.db` (and `pantry.db-wal` and `pantry.db-shm` when they exist) from the selected provider backup without touching the production server. For example, create a temporary server from the backup image in the provider console, read `/opt/pantry-pal/shared/` there, and delete the temporary server afterwards. Never use the provider's rebuild or restore-in-place feature on the production server. A daily backup is crash-consistent, so a `-wal` file next to the database is expected and must be kept with it.

Record the checksums where you obtained the files (`sha256sum` on the temporary server, or `Get-FileHash` locally), transfer them to `$W/backup/` on the production server with `scp`, and compare the checksums after transfer. They must be identical at every hop.

On the production server, with `<backup timestamp>` noted in your evidence record:

```bash
ls -l "$W/backup"
sums "$W/backup" > "$W/backup.sums"
cat "$W/backup.sums"
node "$W/verify.cjs" "$W/backup" > "$W/backup.report"
cat "$W/backup.report"
```

Continue only if `RESULT=PASS` is in `backup.report` and the checksums match those recorded at the source. If the backup is missing, damaged, or fails, go to [Failure recovery](#failure-recovery).

### 4. Restore the backup into the live location and verify it

```bash
put "$W/backup"
sums "$S" > "$W/restored.sums"
diff "$W/backup.sums" "$W/restored.sums" && echo "PASS: restored checksums and sidecars match the backup" || echo "FAIL: restored files differ from the backup"
node "$W/verify.cjs" "$S" > "$W/restored.report"
diff "$W/backup.report" "$W/restored.report" && echo "PASS: restored summary matches the backup" || echo "FAIL: restored summary differs from the backup"
```

Both `PASS` lines must print, and `restored.report` must show `integrity_check=ok`, `foreign_key_check_rows=0`, and `RESULT=PASS`. The report lists every table's row count and `change_counter.value`; record those counts and the checksums, nothing else. The service is still stopped. If anything fails, go to [Failure recovery](#failure-recovery) and do not retry the restore over the live files.

### 5. Put the pre-test live database back, verify, and restart

```bash
put "$W/live"
sums "$S" > "$W/final.sums"
diff "$W/live.source.sums" "$W/final.sums" && echo "PASS: live checksums and sidecars match the pre-test copy" || echo "FAIL: live files differ from the pre-test copy"
node "$W/verify.cjs" "$S" > "$W/final.report"
diff "$W/live.source.report" "$W/final.report" && echo "PASS: live summary matches the pre-test copy" || echo "FAIL: live summary differs from the pre-test copy"
stat -c '%a %U:%G %n' "$S"/pantry.db* | diff "$W/live.modes" - && echo "PASS: modes and owners match" || echo "FAIL: modes or owners differ"
```

Start the service only when all three `PASS` lines print and `final.report` shows `RESULT=PASS`. If the modes differ, correct them to match `live.modes` and rerun the check. Checksums are compared before the restart because a running service changes the files.

```bash
systemctl start pantry-pal
systemctl is-active pantry-pal
curl -fsS http://127.0.0.1:3100/api/health
```

Expected: `active` and `{"status":"ok"}`. Then run the [health, redirect, and header checks](#verify-health-https-and-headers) from the workstation and confirm both users can still sign in. The restore test is complete.

### 6. Record the result and clean up

Record only: provider backup timestamp, maintenance window, the SHA-256 checksums and sidecar presence of the backup and live sets, the per-table row counts and `change_counter.value` for both, `integrity_check` and `foreign_key_check` results, and PASS or FAIL for each comparison. Never record row values or personal data.

`$W` and the off-server copy contain personal data (emails, password hashes). Keep them until the household signs off that the live service is healthy, then delete both. Delete `$W` only after the service has been healthy and the pre-test copy is no longer needed:

```bash
rm -r "$W"
```

### Failure recovery

Applies to any failed check, failed command, closed session, or interruption after the service was stopped.

1. Leave the service stopped. Do not start it while any provider backup file is in `$S`, and do not start it to see what happens.
2. If the pre-test copy in `$W/live` passed its checks in step 2, run step 5 (`put "$W/live"` and its checks), then start the service.
3. If `$W/live` is missing or fails its checks, restore from the off-server copy: `scp` it back into `$W/live`, compare checksums with `live.source.sums`, then run step 5.
4. If neither copy is usable, leave the service stopped and escalate. Do not use a deploy backup (`shared/backups/<release id>.db` and its `-wal` and `-shm`) or a provider backup to finish or restart this restore test. Any separate disaster-recovery choice to use one of them needs its own explicit operator decision (with the household's agreement) and integrity and equivalence validation before use, and must never be reported as a successful AC-005 restore test.
5. After recovery, check health and record the outcome as failed with the cause. Rerun the test in a new window only after the cause is fixed.

If the session closed, set `S` and `W` again (the `$W` folder name is in your terminal history and in the `ls /root` listing), redefine `sums` and `put`, and check `systemctl is-active pantry-pal` before anything else.
