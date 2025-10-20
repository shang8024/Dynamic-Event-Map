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

### 2. Build Images
```powershell
# Build API image
docker build -t dynamic-event-map-api:latest ./api

# Build Client image
docker build -t dynamic-event-map-client:latest ./client
```

### 3. Deploy Stack with 2 API Replicas
```powershell
# Load .env variables into current PowerShell session
Get-Content .env | ForEach-Object { 
    if($_ -match '^([^=]+)=(.*)$') { 
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') 
    } 
}

# Deploy the stack
docker stack deploy -c docker-compose.swarm-local.yml dynamic-event-map
```
### 4. Access the Application
- **Frontend**: http://localhost:80
- **Backend API**: http://localhost/api
- **Database**: localhost:5432
