# Dynamic Event Map

Discover Toronto events across a GTA-wide interactive map. Browse by location, category and date, save activities, and share local discoveries.

[Explore the live map](https://www.dynamic-event-map.cloud/)

![Event map with photo markers and a compact event panel](images/main_page.png)
![Event detail page with a time, location and save card](images/event.png)

## Features

- GTA-wide map with location search, category/date/distance filters, photo markers, and grouped event counts.
- Official Toronto listings and community-created events, with owner and administrator editing.
- Multiple dates per event, shareable detail pages, and saved history after events end.
- Google and email/password sign-in, email verification, and password reset through Firebase.
- Saved events and optional recommendations based on saved categories, with explanations.
- Live comments, cached comment previews, a notification inbox, and separate reminder/marketing preferences.
- Responsive layouts, keyboard navigation, and persistent day/night modes.

## Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React, Vite, Tailwind CSS, DaisyUI, Google Maps JavaScript API, Places API (New) |
| Backend | Node.js, Express, Socket.IO |
| Data | PostgreSQL 16, Redis 7 |
| Authentication | Firebase Authentication |
| Infrastructure | AWS Lightsail, Docker Swarm, Traefik, Nginx, Let's Encrypt |
| CI | GitHub Actions: tests, lint, build and security checks |
| Manual releases & backups | Docker Buildx, GHCR, Amazon S3 |
| Optional email pipeline | Amazon SES, SNS; sending disabled by default |

## Development

Requires Docker with Compose and Node.js 22.12+. Commands use Bash (WSL on Windows).

Copy `.env.example` to `.env`, then fill in:

| Configuration | Required values |
| --- | --- |
| Google Maps | `VITE_GOOGLE_MAPS_KEY` and `VITE_GOOGLE_MAPS_MAP_ID` (JavaScript vector Map ID) |
| Firebase web app | The `VITE_FIREBASE_*` values in `.env.example`; set `FIREBASE_PROJECT_ID` to the same project ID |
| Local database | Choose your own `DB_PASSWORD`; the other local defaults can stay as supplied |

Enable **Maps JavaScript API** and **Places API (New)**, and restrict your development Maps key to `http://localhost:3000/*` and those APIs. In Firebase, enable Google and email/password sign-in and add `localhost` to authorized domains. Basic local development needs no AWS credentials or Firebase Admin private key. Keep `.env` out of Git.

```sh
cp .env.example .env
# Fill in the values above before continuing.
```

Start the local database/cache and apply migrations once to the fresh database:

```sh
docker compose -f docker-compose.dev.yml up -d --wait db redis
for migration in db/migrations/[0-9]*.sql; do
  docker compose -f docker-compose.dev.yml exec -T db sh -ec \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$migration"
done
docker compose -f docker-compose.dev.yml up --build -d
```

Open [localhost:3000](http://localhost:3000). The frontend uses the Vite development server with hot reload; routine frontend edits do not need another image build.

Optional: populate the empty local database from Toronto's official feed (no Toronto API key required):

```sh
npm ci --prefix infra/ingest
DB_HOST=127.0.0.1 REDIS_HOST=127.0.0.1 \
  node --env-file=.env infra/ingest/update_toronto_events.js --write
```

## Deploy

GitHub Actions runs **CI only** on pull requests, pushes to `main`, and manual runs. It does not publish images, connect to AWS, or deploy. CI needs no repository secrets. Production releases are manual, using Bash/WSL, Docker Buildx, Git, `jq`, and an authenticated GitHub CLI account with `write:packages` access to your GHCR packages.

**Prepare the host once.** Use Ubuntu 24.04 with DNS pointing to the host, public ports 80/443, and SSH restricted to your administrator IP. Copy the reviewed release files to `/root/deploy`, run [install_host.sh](infra/scripts/bootstrap/install_host.sh), and initialize the single-node Docker Swarm. Create the external Docker secrets named in [stack.yml](stack.yml) from protected files outside Git. Run [setup_infra.sh](infra/scripts/bootstrap/setup_infra.sh), fill in the root-owned, mode `0600` `/root/deploy/.env` using the [production example](infra/env/.env.production.example), then run [start_database.sh](infra/scripts/bootstrap/start_database.sh) on a **fresh host only**. Apply and record the numbered migrations before the first full deployment. Keep database/cache ports private; keep optional email delivery disabled until its separate credentials and feedback handling are configured.

**Build a reviewed commit locally.** Wait for its CI run to pass. Store production `VITE_GOOGLE_MAPS_*` and `VITE_FIREBASE_*` web settings in a protected file outside Git; restrict the Maps key to your production domain and authorize that domain in Firebase. These browser settings must never contain Firebase Admin, AWS, or SES private credentials. Replace `OWNER/REPO` below with your repository:

```sh
set -eu
set -a
. /secure/path/frontend.env
set +a
export GITHUB_REPOSITORY="OWNER/REPO"
export GITHUB_ACTOR="$(gh api user --jq .login)"
export GITHUB_SHA="$(git rev-parse HEAD)"
export GH_TOKEN="$(gh auth token)"
bash infra/scripts/build_release.sh
unset GH_TOKEN
sha256sum release/eventmap-release.tar.gz
```

The script requires a clean committed checkout, publishes four images, and creates an ignored `release/eventmap-release.tar.gz` with immutable image digests and committed deployment files. Keep the bundle and its checksum together; do not rebuild an already accepted commit with different images.

**Transfer and deploy.** Configure an `eventmap` SSH alias outside Git with your host, private key, and a verified host fingerprint. Upload the bundle, its validator, and reviewed migration SQL:

```sh
ssh eventmap 'umask 077; mkdir -p ~/eventmap-upload'
scp release/eventmap-release.tar.gz infra/scripts/ci_deploy_lightsail.py eventmap:eventmap-upload/
scp -r db/migrations eventmap:eventmap-upload/
```

On the host, open a root Bash shell (`sudo -i`). Take and verify a backup before applying any new migrations, and rehearse their recovery on an isolated database. Existing hosts use `bash /root/deploy/infra/scripts/run_swarm_job.sh backup`; scheduled backup and ingestion jobs remain on the host's systemd timers.

<details>
<summary>Apply a pending database migration</summary>

Run once for each **unapplied**, reviewed SQL file, in numeric order. Adjust the upload path for your SSH user. Never rewrite an applied migration or create its ledger without successfully executing its SQL:

```sh
MIGRATION=/home/ubuntu/eventmap-upload/migrations/NNN_name.sql
(
  set -eu
  umask 077
  flock -n 9
  LEDGER="/var/lib/eventmap/migrations/$(basename "$MIGRATION" .sql).applied"
  test ! -e "$LEDGER"
  mapfile -t DB_TASKS < <(docker ps -q --filter label=com.docker.swarm.service.name=eventmap_db)
  test "${#DB_TASKS[@]}" -eq 1
  docker exec -i "${DB_TASKS[0]}" sh -ec '
    export PGPASSWORD="$(cat /run/secrets/pg_password)"
    exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  ' < "$MIGRATION"
  install -d -m 700 /var/lib/eventmap/migrations
  sha256sum "$MIGRATION" > "$LEDGER"
) 9>/var/lock/eventmap-maintenance.lock
```

</details>

Set the reviewed full commit SHA, lowercase GHCR prefix, and checksum recorded on the build machine. Verify/stage the bundle, take a pre-deploy backup, then roll out by digest:

```sh
set -eu
umask 077
UPLOAD=/home/ubuntu/eventmap-upload
SHA=REVIEWED_FULL_COMMIT_SHA
PREFIX=ghcr.io/owner/repo-production
DIGEST=VERIFIED_BUNDLE_SHA256
python3 "$UPLOAD/ci_deploy_lightsail.py" install-bundle \
  --bundle "$UPLOAD/eventmap-release.tar.gz" --digest "$DIGEST" \
  --sha "$SHA" --prefix "$PREFIX"
bash /root/deploy/infra/scripts/run_swarm_job.sh backup
bash "/root/eventmap-releases/$SHA/infra/scripts/deploy.sh" "$PREFIX" "$SHA"
```

Deployment refuses missing/changed migration checksums and waits for service convergence and `/api/readyz`. Private GHCR packages require a protected, read-only registry login on the host. After success, check HTTPS, sign-in, map loading, and live comments. If deployment fails, inspect `docker service ps` and the preserved `/root/eventmap-release-history`; application rollback does not undo database migrations. Keep private keys, tokens, secret files, and host configuration outside the repository and never print them in logs.

## Data and license

Contains information licensed under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/). Event schedules can change; follow source links and confirm details with organizers. The data licence does not imply City endorsement and is separate from the source-code licence.

Application code is distributed under the [MIT License](https://github.com/shang8024/Dynamic-Event-Map/blob/main/LICENSE). Original copyright notices and contributor attribution are retained in the licence and Git history.
