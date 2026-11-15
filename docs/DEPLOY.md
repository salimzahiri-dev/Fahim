# Deploying Fahim (backlog D2)

This is everything needed to put the pilot online once the owner has chosen a host and a backup provider. Nothing here creates an account; the steps marked **(owner)** need one.

What runs (`docker-compose.prod.yml`):

| Service | Role | Exposed |
|---|---|---|
| `caddy` | HTTPS (automatic certificate), reverse proxy, security headers | ports 80 and 443 |
| `app` | Next.js server, `FAHIM_ENV=production` | only to Caddy |
| `db` | PostgreSQL 17, data in the `fahim-db` volume | nothing; no internet access |
| `init` | migrations, application role password, then exits; also runs `invite` | nothing |
| `backup` | nightly encrypted `pg_dump`, copied to S3-compatible storage | nothing |

**Before students can play:** the lesson has `validated: false` until a teacher reviews it (backlog A2). In production the server refuses to start a session of an unvalidated lesson (`503 lesson_not_validated`). The site, sign-in and `/revue` work before that.

## 1. What the owner chooses and creates (owner)

1. **A Linux server** with Docker Engine and the Compose plugin (any VPS: 2 vCPU, 2 to 4 GB RAM, 40 GB disk, Ubuntu 24.04 LTS is fine). A region close to Morocco keeps pages fast. Check what Moroccan law (09-08, CNDP) asks for personal data of minors hosted abroad.
2. **A domain name** (or a subdomain), with an `A` record pointing to the server's IPv4 address. Add an `AAAA` record only after reading the IPv6 note in step 7.
3. **An S3-compatible bucket at a provider other than the server's host** (the "second place" of D2), for example Cloudflare R2, Backblaze B2, Scaleway or OVHcloud Object Storage. In its settings:
   - an access key limited to this bucket, allowed to write, read and list objects (backups never delete anything);
   - a lifecycle rule that deletes objects after 30 days;
   - object versioning or object lock if the provider offers it, so a stolen key cannot erase the history.
   Note the endpoint URL, the bucket name, the region (`auto` when the provider has none) and the key pair.
4. **The backup key pair**, made on the owner's own computer, never on the server. With Docker (PowerShell or any shell):

   ```
   docker run --rm -v "${PWD}:/out" postgres:17-alpine sh -c "apk add --no-cache age >/dev/null && age-keygen -o /out/fahim-backup-key.txt"
   ```

   The file `fahim-backup-key.txt` holds the **private key**: keep it in the password manager and on one offline copy (paper or USB key). Without it no backup can be read; with it anyone can. The line `# public key: age1…` in that file is the **public key**, the only part that goes on the server.

## 2. Secrets the owner provides

All go into one file on the server, `/etc/fahim/fahim.env` (template: `deploy/fahim.env.example`).

| Variable | What it is | Where it comes from |
|---|---|---|
| `FAHIM_DOMAIN` | the site's name, e.g. `fahim.example.ma` | the domain (step 1.2) |
| `ANTHROPIC_API_KEY` | the pilot's API key | the Anthropic console |
| `BACKUP_AGE_RECIPIENT` | backup public key, `age1…` | step 1.4 |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION` | where backups go | step 1.3 |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the bucket's access key | step 1.3 |
| `FAHIM_DB_PASSWORD` | PostgreSQL superuser password | generated on the server (step 3) |
| `FAHIM_APP_DB_PASSWORD` | password of the application role | generated |
| `FAHIM_COOKIE_SECRET` | signs the student cookie | generated |
| `FAHIM_PROXY_SECRET` | proves to the app that a request came through Caddy | generated |

Optional: `FAHIM_MODEL`, `FAHIM_MAX_SESSIONS_PER_DAY` (3 by default, counted per calendar day in Africa/Casablanca).

Kept outside the server: the backup private key (step 1.4) and the invitation codes, which are shown once.

## 3. First installation (on the server)

```bash
# 1. The code
sudo git clone https://github.com/salimzahiri-dev/Fahim.git /opt/fahim
cd /opt/fahim

# 2. The env file, readable by root only
sudo install -d -m 700 /etc/fahim
sudo install -m 600 deploy/fahim.env.example /etc/fahim/fahim.env
# Four random secrets (FAHIM_DB_PASSWORD, FAHIM_APP_DB_PASSWORD, FAHIM_COOKIE_SECRET, FAHIM_PROXY_SECRET):
for v in FAHIM_DB_PASSWORD FAHIM_APP_DB_PASSWORD FAHIM_COOKIE_SECRET FAHIM_PROXY_SECRET; do
  sudo sed -i "s|^$v=.*|$v=$(openssl rand -base64 48 | tr -d '\n/+=')|" /etc/fahim/fahim.env
done
sudo nano /etc/fahim/fahim.env   # fill in the domain, the API key and the backup values

# 3. Start everything (builds the images, runs the migrations, gets the certificate)
sudo docker compose -f docker-compose.prod.yml --env-file /etc/fahim/fahim.env up -d --build
sudo docker compose -f docker-compose.prod.yml --env-file /etc/fahim/fahim.env ps
```

`init` must show `exited (0)` and the others `running`. The site answers at `https://FAHIM_DOMAIN` once Caddy has its certificate (a few seconds; ports 80 and 443 must be open in the host's firewall).

## 4. Accounts and codes

The same `init` image runs the operator script. Each command prints a code once; give it to the person, do not store it.

```bash
C="sudo docker compose -f docker-compose.prod.yml --env-file /etc/fahim/fahim.env run --rm init npx tsx scripts/invite.ts"
$C --org "Pilote Fahim" --owner "Propriétaire"     # the owner, for /revue
$C --org "Pilote Fahim" --name "Élève 1"           # one per student, five for the pilot
$C --org "Pilote Fahim" --replace <user id>        # a lost code: new code, the old one stops working
```

The owner account reviews and cannot play a session (decision 0006). To try the tutor, create a student for yourself, for example `--name "Essai propriétaire"`.

## 5. Checks after the first start

1. `https://FAHIM_DOMAIN` shows the first screen with a valid certificate; `http://` redirects to `https://`.
2. A student code signs in; the owner code opens `/revue`.
3. The app logs have no development warning: `… logs app | grep -i development` prints nothing.
4. The attempt limit sees real client addresses: make one wrong sign-in from a phone on mobile data and one from another network, then
   `… exec db psql -U postgres -d fahim -c "SELECT count(*) FROM sign_in_attempts"` shows 2 rows. One row would mean every client shares one bucket (see the IPv6 note in step 7).
5. A first backup by hand, then the restore drill of step 6:
   `… exec backup sh -c '. /run/backup.env && backup.sh'` ends with `copied to s3://…` and `done`.

(`…` stands for `sudo docker compose -f docker-compose.prod.yml --env-file /etc/fahim/fahim.env`.)

## 6. Backups and restore

Every night at 02:30 (Africa/Casablanca), `backup` runs `pg_dump`, encrypts it with the public key, keeps the last 7 files in the `fahim-backups` volume, uploads the file to `s3://S3_BUCKET/fahim/` and checks the uploaded size. Its log is `… logs backup`; a failed night prints `FAILED` or an error. Nobody is alerted automatically yet: look at the log during the daily review, or check that the bucket has a file for each night.

**Restore drill (once after installation, then once a month).** It restores into a new database and changes nothing in production:

```bash
# Copy the private key to the server for this command only, then delete it.
scp fahim-backup-key.txt server:/tmp/k.txt
sudo docker compose -f docker-compose.prod.yml --env-file /etc/fahim/fahim.env run --rm \
  -v /tmp/k.txt:/run/age-identity.txt:ro backup restore.sh latest fahim_restore_check
shred -u /tmp/k.txt
# It prints the number of organizations, users and sessions, and the date of the last session.
sudo docker compose -f docker-compose.prod.yml --env-file /etc/fahim/fahim.env exec db dropdb -U postgres fahim_restore_check
```

`restore.sh` accepts `latest`, an object name (`fahim-20261116T013000Z.dump.age`) or a local file in `/backups/`. It refuses a wrong key, and it refuses a target database that already exists.

**Real restore** (the production database is damaged):

```bash
D="sudo docker compose -f docker-compose.prod.yml --env-file /etc/fahim/fahim.env"
$D run --rm -v /tmp/k.txt:/run/age-identity.txt:ro backup restore.sh latest fahim_restored
$D stop app
$D exec db psql -U postgres -c "ALTER DATABASE fahim RENAME TO fahim_damaged" -c "ALTER DATABASE fahim_restored RENAME TO fahim"
$D up -d          # init re-applies the role password and any newer migration
shred -u /tmp/k.txt
```

Keep `fahim_damaged` until the restored site has been checked, then drop it. On a new server, install as in step 3 and restore before inviting anyone: the restore creates the application role if it is missing.

## 7. Updates and notes

**Update:** `cd /opt/fahim && sudo git pull && sudo docker compose -f docker-compose.prod.yml --env-file /etc/fahim/fahim.env up -d --build`. `init` applies new migrations before the app restarts.

**IPv6:** Docker keeps the client's IPv4 address on published ports. Depending on the Docker version and settings, an IPv6 connection may instead be relayed by `docker-proxy`, and Caddy then sees an internal address for every IPv6 visitor, who would all share one attempt bucket. Without an `AAAA` record this does not arise. With one, redo check 5.4 from an IPv6 network; if it shows one bucket, enable IPv6 for the containers (`"ipv6": true, "ip6tables": true` in `/etc/docker/daemon.json`) or remove the `AAAA` record. This was not tested: the local test ran on Docker Desktop, where every request comes from the Docker gateway.

**Time zone:** the daily limit and the backup time follow the time zone database inside the images. Version 2026e and later puts Casablanca at UTC+0 on dates where older data (2026b) says UTC+1, so rebuild the images with fresh base images when Morocco changes its time: `… build --pull`, then `… up -d`.

**What this setup does not do yet:** alerting on failed backups or a down site, log shipping, and a second server. The pilot does not need them to start; they are worth adding before more students join.
