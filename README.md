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

GitHub Actions runs **CI only**. Deployment is an explicit local command; no AWS credentials or deployment secrets are needed in GitHub Actions.

On Windows, install Python 3.11+, Git, Docker Desktop (Linux containers), OpenSSH and GitHub CLI. Sign in with `gh auth login` and grant GHCR publishing access with `gh auth refresh --scopes write:packages`. The SSH key must already have administrator access to the configured server; pin its independently verified host key in your `known_hosts` file.

**Configure once:** copy [deploy.example.json](infra/env/deploy.example.json) to `%LOCALAPPDATA%\DynamicEventMap\deploy.json` and fill in the repository, server and external file paths. Copy the [browser settings example](infra/env/.env.frontend.production.example) to the configured `frontend_env` path and fill in your production Maps/Firebase web settings. Restrict the Maps key to your production domain. Keep both files, keys, logs and release artifacts outside the checkout. Never put AWS, database or Firebase Admin credentials in browser settings.

Commit and push `main`, then run from the repository in PowerShell:

```powershell
.\deploy.ps1 -Check  # Read-only local/configuration/CI checks; no SSH or deployment.
.\deploy.ps1         # Wait for this commit's CI, publish images and deploy.
# Optional alternate private configuration:
.\deploy.ps1 -Config C:\secure\eventmap\deploy.json
```

If your PowerShell policy blocks local scripts, run `powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1` for this invocation. The launcher does not change your machine's execution policy.

The command requires a clean `main` matching GitHub and passing CI. It builds committed sources, reuses verified existing commit-tagged images, publishes four GHCR images, validates an immutable release bundle, and connects using pinned SSH. On the host it verifies migration checksums, takes a verified backup, restores and rehearses any new migrations in an isolated database, applies them in order, deploys by image digest, and checks the installed release and HTTPS readiness. A successful repeat verifies the current release without another backup or rollout. It does not change DNS, firewall rules, email delivery or scheduled jobs.

Failures stop the sequence. Private logs and checkpoints are saved in the configured `state_dir` and `/var/lib/eventmap/local-releases/<commit>` on the host. An interrupted production migration is not automatically replayed. Inspect its SQL, schema and ledger before recovery; application rollback does not undo database migrations. Failed rehearsal databases are retained for inspection; successful releases remove only their own rehearsal database.

**Prepare a new host separately:** use Ubuntu 24.04, point DNS at it, allow ports 80/443 and restrict SSH to your administrator IP. Use [install_host.sh](infra/scripts/bootstrap/install_host.sh), initialize Swarm, create the external Docker secrets in [stack.yml](stack.yml), and configure the root-owned mode `0600` `/root/deploy/.env` from the [production example](infra/env/.env.production.example). Use [setup_infra.sh](infra/scripts/bootstrap/setup_infra.sh) and [start_database.sh](infra/scripts/bootstrap/start_database.sh) on a **fresh host only**, and apply/record the initial migrations after a verified recovery rehearsal. This release command targets an already initialized installation with working backup/restore services. Packages must be public or the host must have a protected read-only GHCR login. Keep database/cache ports private and optional email sending disabled until configured.

## Data and license

Contains information licensed under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/). Event schedules can change; follow source links and confirm details with organizers. The data licence does not imply City endorsement and is separate from the source-code licence.

Application code is distributed under the [MIT License](https://github.com/shang8024/Dynamic-Event-Map/blob/main/LICENSE). Original copyright notices and contributor attribution are retained in the licence and Git history.
