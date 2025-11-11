# Dynamic Event Map
A cloud-native web application for discovering local events in real time. Users can explore events on an interactive map, create and manage events, and access public event feeds.

---

## Description

The **Dynamic Event Map** centralizes user-submitted and public event information, providing a real-time, interactive map to discover local activities such as concerts, festivals, food markets, and community gatherings. The platform supports community engagement, spontaneous participation, and local exploration.

The project demonstrates **scalable, reliable cloud deployment** using Docker Swarm on DigitalOcean, integrating CI/CD pipelines, automated backups, and external services like Google Maps.

## Architecture

- **Frontend**: React.js application served by Nginx
- **Backend**: Node.js REST API with Express
- **Database**: PostgreSQL with initialization scripts
- **Cache**: Redis for performance optimization
- **Load Balancer**: Nginx reverse proxy
- **Orchestration**: Docker Swarm for high availability

# Quick Start Guide

## Local Development (Docker Compose)

### 1. Clone and Setup
```bash
git clone https://github.com/chkaty/Dynamic-Event-Map.git
cd Dynamic-Event-Map
```

### 2. Create Environment File
```bash
# Create .env file with your configuration
cp .env.example .env
```

The env file should contains:
```
DB_USER=
DB_PASSWORD=
DB_NAME=
DB_PORT=
REDIS_PORT=
BACKEND_PORT=
FRONTEND_PORT=
VITE_GOOGLE_MAPS_KEY=

# Firebase client configuration
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
```
### 3. Enable Firebase authentication
When running as a developer, there should be code added which allows for token verification in Firebase without an account.
To run authentication with your service account key:

Create a file "firebase-service-account.json" in /api:
```bash
cd /Dynamic-Event-Map/api
touch firebase-service-account.json
```
In Firebase, from Dynamic-Event-Map project, navigate to: 
Project Overview -> Project Settings (gear icon next to Project Overview) -> Service Accounts -> Generate new private key
Copy the JSON service account key into firebase-service-account.json.

### 4. Run with Docker Compose
```bash
# Start all services
docker-compose -f docker-compose.dev.yml up --build
```

### 5. Access the Application
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **Database**: http://localhost:5432

---

## Docker Swarm Local

### 1. Initialize Docker Swarm
```powershell
# Initialize swarm mode
docker swarm init

# Add labels to node for database placement
docker node update --label-add postgres=true $(docker info --format '{{.Swarm.NodeID}}')
docker node update --label-add redis=true $(docker info --format '{{.Swarm.NodeID}}')
```
### 2. Local Environment
```powershell
# Load .env variables into current PowerShell session
Get-Content .env | ForEach-Object { 
    if($_ -match '^([^=]+)=(.*)$') { 
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') 
    } 
}
```
or
```bash
set -a; source .env; set +a
```
### 3. Create Firebase service account secret
```
docker secret create firebase-service-account.json ./api/firebase-service-account.json
```
### 4. Build Images
```powershell
# Build API image
docker build -t dynamic-event-map-api:latest ./api

# Build Client image
$Env:DOCKER_BUILDKIT=1
docker build -f ./client/Dockerfile `
  -t dynamic-event-map-client:latest `
  --build-arg VITE_GOOGLE_MAPS_KEY=$Env:VITE_GOOGLE_MAPS_KEY `
  --build-arg VITE_FIREBASE_API_KEY=$Env:VITE_FIREBASE_API_KEY `
  --build-arg VITE_FIREBASE_AUTH_DOMAIN=$Env:VITE_FIREBASE_AUTH_DOMAIN `
  --build-arg VITE_FIREBASE_PROJECT_ID=$Env:VITE_FIREBASE_PROJECT_ID `
  --build-arg VITE_FIREBASE_STORAGE_BUCKET=$Env:VITE_FIREBASE_STORAGE_BUCKET `
  --build-arg VITE_FIREBASE_APP_ID=$Env:VITE_FIREBASE_APP_ID `
  --build-arg VITE_FIREBASE_MESSAGING_SENDER_ID=$Env:VITE_FIREBASE_MESSAGING_SENDER_ID `
  client

# Build Event Ingest image
docker build -t dynamic-event-map-events-ingest:latest ./infra/ingest
```

### 5. Deploy Stack with 2 API Replicas
```
docker stack deploy -c docker-compose.swarm-local.yml eventmap
```
### 6. Access the Application
- **Frontend**: http://localhost
- **Backend API**: http://localhost/api
- **Database**: localhost:5432

### 7. Pull with event_ingest service

```
# set replicas to 1 so a task is actually created
docker service update --replicas 1 eventmap_events_ingest
# after task done, scale back to 0
docker service update --replicas 0 eventmap_events_ingest
```

## Deploy Swarm on Digital Ocean

### What you need before starting

- Droplet (Ubuntu LTS). Open ports: 80 (web), optionally 5000 (API), and 22 (SSH).

- DO Volume attached to this droplet (we’ll mount it at /mnt/pgdata).

- Images available in a registry (e.g., GHCR):
    - ghcr.io/<OWNER>/<REPO>-api:latest
    - ghcr.io/<OWNER>/<REPO>-client:latest
    - ...(other services that need internal network)

- Your stack.yml expects:

    - Postgres, Redis bound to /mnt/pgdata/postgres-data, /mnt/pgdata/redis-data
    - Swarm secret named pg_password, redis_password
    - Your db/ init scripts (run only on first DB init)
    - Your Firebase Service Account JSON file

- A Domain owned by yourself and connected to your droplet (A records, service providers setup, ...)

## First Deployment - One-time setup

### 1. SSH into the droplet and install Docker
```
# As root (or sudo -i to become root)
apt-get update
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER
```
### 2. Mount the DigitalOcean Volume at /mnt/pgdata
```
ls -l /dev/disk/by-id/           # find the DO volume (e.g., scsi-0DO_Volume_...)
mkfs.ext4 -F /dev/disk/by-id/<YOUR_VOLUME_ID>
mkdir -p /mnt/pgdata
mount -o defaults /dev/disk/by-id/<YOUR_VOLUME_ID> /mnt/pgdata

# Persist across reboots
echo "/dev/disk/by-id/<YOUR_VOLUME_ID> /mnt/pgdata ext4 defaults,nofail 0 2" >> /etc/fstab
mount -a

mkdir -p /mnt/pgdata/postgres-data
mkdir -p /mnt/pgdata/redis-data

chown -R 999:999 /mnt/pgdata/postgres-data
chmod 700 /mnt/pgdata/postgres-data

chmod 777 /mnt/pgdata/redis-data
```

### 3. Initialize Docker Swarm
```
docker swarm init --advertise-addr <YOUR_PUBLIC_IPV4>

docker node update --label-add postgres=true $(docker info --format '{{.Swarm.NodeID}}')
docker node update --label-add redis=true $(docker info --format '{{.Swarm.NodeID}}')
```

### 4. Create the Postgres and redis password secret
```
echo -n 'YOUR_STRONG_DB_PASSWORD' | docker secret create pg_password -
docker secret ls | grep pg_password

echo -n 'YOUR_STRONG_REDIS_PASSWORD' | docker secret create redis_password -
docker secret ls | grep redis_password
```

### 5. Create a file "firebase-service-account.json" in /api:
```bash
cd /api
touch firebase-service-account.json
```
In Firebase, from Dynamic-Event-Map project, navigate to: 
Project Overview -> Project Settings (gear icon next to Project Overview) -> Service Accounts -> Generate new private key
Copy the service account key JSON into firebase-service-account.json.

## Pull & Deploy, Go to Github Action CI/CD section or manually follow:

### 6. Put your stack files and .env files on the droplet

Create a deploy directory and copy your files (via scp or any secure method):
```
mkdir -p /root/deploy
# From your laptop:
# scp -r stack.yml db/ root@<YOUR_PUBLIC_IPV4>:/root/deploy/
```
Also add/copy a `.env` file to `/root/deploy`. It should contains following:
```
BACKEND_PORT=5000
DB_PORT=5432
DB_NAME=eventsdb
DB_USER=user
REDIS_PORT=6379
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
DOMAIN=<your-domain.com>
EMAIL=<your-LE-domain-email>
```

### 7. Log into your registry on the droplet and pull images
```
docker login ghcr.io -u <GH_USERNAME>
# (enter your GHCR PAT with packages:read when prompted)

docker pull ghcr.io/<OWNER>/<REPO>-api:latest
docker pull ghcr.io/<OWNER>/<REPO>-client:latest
```

### 8. Deploy the stack
```
cd /root/deploy

# Export env for stack interpolation
set -a
. ./.env
set +a

docker stack deploy -c stack.yml eventmap --with-registry-auth

# Watch it come up
docker stack ls
docker service ls
docker service ps eventmap_db
docker service ps eventmap_api
docker service ps eventmap_client

# Logs (tail)
docker service logs -f eventmap_api
docker service logs -f eventmap_db
```

## After first deployment, One-time Setup (on droplet)

### 9. allow tcp ports:
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### 10. Setup Scheduled Timers

Copy the `infra` folder to your droplet `/root/deploy`:

Run `bash /root/deploy/infra/scripts/bootstrap/setup_infra.sh`.


## CI/CD pipelines

On your repo, add the following:

- Repository secretes:

  - `GHCR_USER` (your GH username or org service account)

  - `GHCR_PAT` (token with read:packages and write:packages)

  - `DO_SSH_KEY` (your private SSH key contents)

  - `GOOGLE_MAPS_KEY`

  - `FIREBASE_API_KEY`

  - `FIREBASE_PROJECT_ID`

  - `FIREBASE_APP_ID`

  - `FIREBASE_MESSAGING_SENDER_ID`

  - `DOMAIN`

  - `EMAIL`

- Repository variables:

- `DO_SSH_HOST` (droplet IP)

- `DO_SSH_USER` (e.g., `root` or your sudo user)

- `PROD_API_BASE_URL` (e.g., `http://YOUR_IP:5000` or your https domain)

- and other variables inn `.env.example` (except for `DB_PASSWORD`)