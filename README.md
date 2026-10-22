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
| Delivery & backups | GitHub Actions, GHCR, Amazon S3 |
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

## Data and license

Contains information licensed under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/). Event schedules can change; follow source links and confirm details with organizers. The data licence does not imply City endorsement and is separate from the source-code licence.

Application code is distributed under the [MIT License](https://github.com/shang8024/Dynamic-Event-Map/blob/main/LICENSE). Original copyright notices and contributor attribution are retained in the licence and Git history.
