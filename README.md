# Dynamic Event Map

Discover Toronto events on an interactive map. Browse activities by location, category and date, save events for later, and share local discoveries with the community.

[Open the live map](https://www.dynamic-event-map.cloud)

![Toronto events map](images/main_page.png)

## Features

- Interactive Google Maps view with clustered markers, location search and event filters.
- Official City of Toronto event data alongside community submissions.
- Google sign-in and email/password registration through Firebase Authentication, including verification and password reset.
- Personal bookmarks, comments and ownership-controlled event editing.
- Explainable recommendations based on saved categories, with an explicit personalization preference.
- Separate opt-in preferences for event reminders and weekly discovery emails, plus signed unsubscribe links.
- Live updates through Socket.IO, with Redis connecting API replicas.
- Containerized services and documented database import, deployment and recovery workflows.

Email delivery remains disabled while provider feedback, administrative identity checks and real inbox tests are completed. The notification scheduler supports dry runs; saving a preference does not send mail. See [notification behavior and activation checks](docs/NOTIFICATIONS.md).

## Architecture

| Layer | Technology |
| --- | --- |
| Web client | React, Vite, Tailwind CSS, Google Maps |
| API | Node.js, Express, Socket.IO |
| Persistence | PostgreSQL |
| Cache and real-time messaging | Redis |
| Authentication | Firebase Authentication |
| Runtime | Docker Compose for development; Docker Swarm deployment configuration |
| Routing and TLS | Traefik, Nginx, Let's Encrypt |
| Delivery | GitHub Actions, GitHub Container Registry |
| Hosting and backups | AWS Lightsail, private versioned Amazon S3 |
| Email integration | Amazon SES with a PostgreSQL outbox; delivery disabled pending activation checks |

The live deployment uses a single AWS Lightsail VM in Canada (Central), with PostgreSQL, Redis, the API and web client running in Docker Swarm. Daily database backups are stored in a private S3 bucket, and a populated restore has been verified. Multiple containers on one VM do not provide host-level high availability. See the [cloud comparison](docs/CLOUD_PLAN.md) for costs, tradeoffs and the path to managed AWS infrastructure.

## Local development

Requirements: Docker with Compose, a Firebase project, and a restricted Google Maps browser key. Use Node.js 22 or later when running tools outside containers.

1. Copy `.env.example` to `.env` and fill in development configuration. Never commit credentials.
2. Set `FIREBASE_PROJECT_ID` to the same project as `VITE_FIREBASE_PROJECT_ID`, enable Google and email/password sign-in, and authorize the development domain in Firebase. The API verifies ID tokens with public signing certificates; no service-account private key is required for web login. Live notification delivery separately requires administrative identity lookup. See [Firebase authentication configuration](docs/FIREBASE_AUTH.md) for capabilities and limits.
3. Start the development stack:

   ```sh
   docker compose -f docker-compose.dev.yml up --build -d
   ```

4. Open `http://localhost:3000`. The default API address is `http://localhost:5000/api`.
5. Follow [event data instructions](docs/EVENT_DATA.md) to preview and import the official feed. A fresh database does not include downloaded events automatically.

`db/init.sql` runs only when PostgreSQL initializes an empty data directory. Existing databases require explicit migrations; changing that file does not upgrade a running database.

## Maintenance

- [Deployment, database upgrades and recovery](docs/OPERATIONS.md)
- [Official event source, import verification and refresh plan](docs/EVENT_DATA.md)
- [Cloud costs and infrastructure choices](docs/CLOUD_PLAN.md)
- [Account setup and credential rotation](docs/ACCOUNTS.md)
- [Firebase verification without a service-account key](docs/FIREBASE_AUTH.md)
- [Preferences, recommendations and notification operations](docs/NOTIFICATIONS.md)
- [Authentication, email and recommendation roadmap](docs/PRODUCT_PLAN.md)
- [Security review and remaining release checks](docs/SECURITY_AUDIT.md)

The site is deployed over HTTPS. The GitHub Actions production workflow is a separate, manual deployment path, gated by the repository variable `PRODUCTION_ENABLED=true` and its configured environment/secrets. It is not enabled merely by cloning this repository.

## Data and license

Official event information is provided by the City of Toronto under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/). Event availability and schedules can change; retain source links and verify details with the organizer. Data licensing is separate from the application source code.

The application is distributed under the [MIT License](LICENSE). Original copyright notices and contributor attribution are retained there and in Git history.
