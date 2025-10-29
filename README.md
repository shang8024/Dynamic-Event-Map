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
cp .env.example .env && cp client/.env.example client/.env
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
```

### 3. Run with Docker Compose
```bash
# Start all services
docker-compose -f docker-compose.dev.yml up --build
```

### 4. Access the Application
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **Database**: localhost:5432

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
### 2. local environment
```powershell
# Load .env variables into current PowerShell session
Get-Content .env | ForEach-Object { 
    if($_ -match '^([^=]+)=(.*)$') { 
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') 
    } 
}
```
### 3. Build Images
```powershell
# Build API image
docker build -t dynamic-event-map-api:latest ./api

# Build Client image
docker build -f client/Dockerfile.local -t dynamic-event-map-client:latest ./client
```

### 4. Deploy Stack with 2 API Replicas
```
docker stack deploy -c docker-compose.swarm-local.yml dynamic-event-map
```
### 4. Access the Application
- **Frontend**: http://localhost:80
- **Backend API**: http://localhost/api
- **Database**: localhost:5432

## Deploy Swarm on Digital Ocean

### What you need before starting

- Droplet (Ubuntu LTS). Open ports: 80 (web), optionally 5000 (API), and 22 (SSH).

- DO Volume attached to this droplet (we’ll mount it at /mnt/pgdata).

- Images available in a registry (e.g., GHCR):
    - ghcr.io/<OWNER>/<REPO>-api:latest
    - ghcr.io/<OWNER>/<REPO>-client:latest

- Your stack.yml expects:

    - Postgres bound to /mnt/pgdata
    - A Swarm secret named pg_password
    - Your db/ init scripts (run only on first DB init)

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

### 5. Put your stack files on the droplet

Create a deploy directory and copy your files (via scp or any secure method):
```
mkdir -p /root/deploy
# From your laptop:
# scp -r stack.yml db/ root@<YOUR_PUBLIC_IPV4>:/root/deploy/
```

### 6. Create a minimal /root/deploy/.env (no secrets inside)
```
cat >/root/deploy/.env <<'EOF'
BACKEND_PORT=5000
FRONTEND_PORT=80
DB_NAME=eventsdb
DB_USER=user
DB_PORT=5432
REDIS_PORT=6379
# Only keep non-secrets here. The DB password comes from the Swarm secret.
EOF
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

### 9. Setup a Scheduled Timer to Clean Up Docker

## Scheduled Clean & Backup

Copy the `infra` folder to your droplet `/root/deploy`:

Run `bash /root/deploy/infra/scripts/bootstrap/setup_infra.sh`.


## CI/CD

On your repo, add those:

- Repository secretes:

  - `GHCR_USER` (your GH username or org service account)

  - `GHCR_PAT` (token with read:packages and write:packages)

  - `DO_SSH_KEY` (your private SSH key contents)

- Repository variables:

- `DO_SSH_HOST` (droplet IP)

- `DO_SSH_USER` (e.g., `root` or your sudo user)

- `PROD_API_BASE_URL` (e.g., `http://YOUR_IP:5000` or your https domain)

- and other varaibles inn `.env.example` (except for `DB_PASSWORD`)