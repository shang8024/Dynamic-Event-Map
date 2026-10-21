# Dynamic Event Map

Discover Toronto events on an interactive map. Browse activities by location, category and date, save events for later, and share local discoveries with the community.

![Toronto events map](images/main_page.png)

## Features

- Interactive Google Maps view with clustered markers, location search and event filters.
- Official City of Toronto event data alongside community submissions.
- Google sign-in through Firebase Authentication.
- Personal bookmarks, comments and ownership-controlled event editing.
- Live updates through Socket.IO, with Redis connecting API replicas.
- Containerized services and documented database import, deployment and recovery workflows.

Email registration, email reminders, opt-in newsletters and personalized recommendations are planned additions. They are not available in the current application.

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

The initial hosting target is a single VM on DigitalOcean or AWS Lightsail. Multiple containers on one VM do not provide host-level high availability. See the [cloud comparison](docs/CLOUD_PLAN.md) for costs, tradeoffs and the path to managed AWS infrastructure.

## Local development

Requirements: Docker with Compose, a Firebase project, and a restricted Google Maps browser key. Use Node.js 22 or later when running tools outside containers.

1. Copy `.env.example` to `.env` and fill in development configuration. Never commit credentials.
2. Set `FIREBASE_PROJECT_ID` to the same project as `VITE_FIREBASE_PROJECT_ID`, enable Google sign-in, and authorize the development domain in Firebase. The current API verifies ID tokens with public signing certificates; no service-account private key is required. See [Firebase authentication configuration](docs/FIREBASE_AUTH.md) for capabilities and limits.
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
- [Authentication, email and recommendation roadmap](docs/PRODUCT_PLAN.md)
- [Security review and remaining release checks](docs/SECURITY_AUDIT.md)

Production deployment is manual and disabled until the repository variable `PRODUCTION_ENABLED` is set to `true` after provisioning and release checks. The presence of deployment files is not evidence of a currently running public service.

## Data and license

Official event information is provided by the City of Toronto under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/). Event availability and schedules can change; retain source links and verify details with the organizer. Data licensing is separate from the application source code.

The application is distributed under the [MIT License](LICENSE). Original copyright notices and contributor attribution are retained there and in Git history.
