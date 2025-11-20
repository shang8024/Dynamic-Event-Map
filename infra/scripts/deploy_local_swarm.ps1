# PowerShell Script to Deploy Local Docker Swarm Stack
# Usage: .\deploy_local_swarm.ps1 [-NoBuild]
# Options:
#   -NoBuild    Skip building images and use existing local images

param(
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Local Docker Swarm Deployment Script" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Get script directory and project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)

Write-Host "Project Root: $ProjectRoot" -ForegroundColor Gray
Write-Host ""

# Check if Docker is running
Write-Host "[1/8] Checking Docker..." -ForegroundColor Yellow
try {
    docker info | Out-Null
    Write-Host "[OK] Docker is running" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] Docker is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}
Write-Host ""

# Initialize Docker Swarm if not already
Write-Host "[2/8] Initializing Docker Swarm..." -ForegroundColor Yellow
$SwarmStatus = docker info --format '{{.Swarm.LocalNodeState}}'
if ($SwarmStatus -ne "active") {
    Write-Host "Initializing Swarm..." -ForegroundColor Gray
    docker swarm init
    Write-Host "[OK] Docker Swarm initialized" -ForegroundColor Green
} else {
    Write-Host "[OK] Docker Swarm already active" -ForegroundColor Green
}
Write-Host ""

# Add node labels for placement constraints
Write-Host "[3/8] Configuring node labels..." -ForegroundColor Yellow
$NodeId = docker node ls --format '{{.ID}}' --filter role=manager
docker node update --label-add postgres=true $NodeId | Out-Null
docker node update --label-add redis=true $NodeId | Out-Null
Write-Host "[OK] Node labels configured (postgres=true, redis=true)" -ForegroundColor Green
Write-Host ""

# Check for .env file
Write-Host "[4/8] Checking environment configuration..." -ForegroundColor Yellow
$EnvFile = Join-Path $ProjectRoot ".env"
if (-not (Test-Path $EnvFile)) {
    Write-Host "[FAIL] .env file not found!" -ForegroundColor Red
    Write-Host "Please copy .env.example to .env and configure it:" -ForegroundColor Yellow
    Write-Host "  cp .env.example .env" -ForegroundColor Gray
    exit 1
}
Write-Host "[OK] .env file found" -ForegroundColor Green

# Load environment variables
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*)\s*=\s*(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}
Write-Host "[OK] Environment variables loaded" -ForegroundColor Green

# Validate required environment variables
Write-Host "Validating required variables..." -ForegroundColor Gray
$RequiredVars = @(
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME",
    "DB_PORT",
    "REDIS_PORT",
    "BACKEND_PORT",
    "VITE_GOOGLE_MAPS_KEY",
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_APP_ID",
    "VITE_FIREBASE_MESSAGING_SENDER_ID"
)

$MissingVars = @()
foreach ($VarName in $RequiredVars) {
    $Value = [Environment]::GetEnvironmentVariable($VarName, "Process")
    if ([string]::IsNullOrWhiteSpace($Value)) {
        $MissingVars += $VarName
    }
}

if ($MissingVars.Count -gt 0) {
    Write-Host "[FAIL] Missing required environment variables:" -ForegroundColor Red
    foreach ($VarName in $MissingVars) {
        Write-Host "  - $VarName" -ForegroundColor Red
    }
    Write-Host "Please ensure all required variables are set in .env file" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] All required variables present" -ForegroundColor Green
Write-Host ""

# Check for Firebase service account
Write-Host "[5/8] Checking Firebase credentials..." -ForegroundColor Yellow
$FirebaseFile = Join-Path $ProjectRoot "api\firebase-service-account.json"
if (-not (Test-Path $FirebaseFile)) {
    Write-Host "[FAIL] Firebase service account file not found at:" -ForegroundColor Red
    Write-Host "  $FirebaseFile" -ForegroundColor Gray
    Write-Host "Please add your Firebase service account JSON file." -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Firebase service account found" -ForegroundColor Green

# Create or update Docker secret
Write-Host "Creating/updating Docker secret..." -ForegroundColor Gray
$SecretExists = docker secret ls --format '{{.Name}}' | Select-String -Pattern '^firebase-service-account.json$' -Quiet
if ($SecretExists) {
    Write-Host "  Removing existing secret..." -ForegroundColor Gray
    docker secret rm firebase-service-account.json 2>$null | Out-Null
}
docker secret create firebase-service-account.json $FirebaseFile | Out-Null
Write-Host "[OK] Docker secret created" -ForegroundColor Green
Write-Host ""

# Build images (unless -NoBuild flag is set)
if ($NoBuild) {
    Write-Host "[6/8] Skipping build (using existing images)..." -ForegroundColor Yellow
    Write-Host "[OK] Using existing local images" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "[6/8] Building Docker images..." -ForegroundColor Yellow
    Write-Host "This may take several minutes..." -ForegroundColor Gray
    Write-Host ""

    # Build API
    Write-Host "  Building API image..." -ForegroundColor Cyan
    docker build -t dynamic-event-map-api:latest -f (Join-Path $ProjectRoot "api\Dockerfile") (Join-Path $ProjectRoot "api")
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [FAIL] API build failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] API image built" -ForegroundColor Green

    # Build Client
    Write-Host "  Building Client image..." -ForegroundColor Cyan
    $ClientEnvArgs = @(
        "--build-arg", "VITE_GOOGLE_MAPS_KEY=$env:VITE_GOOGLE_MAPS_KEY",
        "--build-arg", "VITE_FIREBASE_API_KEY=$env:VITE_FIREBASE_API_KEY",
        "--build-arg", "VITE_FIREBASE_AUTH_DOMAIN=$env:VITE_FIREBASE_AUTH_DOMAIN",
        "--build-arg", "VITE_FIREBASE_PROJECT_ID=$env:VITE_FIREBASE_PROJECT_ID",
        "--build-arg", "VITE_FIREBASE_STORAGE_BUCKET=$env:VITE_FIREBASE_STORAGE_BUCKET",
        "--build-arg", "VITE_FIREBASE_APP_ID=$env:VITE_FIREBASE_APP_ID",
        "--build-arg", "VITE_FIREBASE_MESSAGING_SENDER_ID=$env:VITE_FIREBASE_MESSAGING_SENDER_ID"
    )
    & docker build -t dynamic-event-map-client:latest @ClientEnvArgs -f (Join-Path $ProjectRoot "client\Dockerfile") (Join-Path $ProjectRoot "client")
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [FAIL] Client build failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] Client image built" -ForegroundColor Green

    # Build Events Ingest
    Write-Host "  Building Events Ingest image..." -ForegroundColor Cyan
    docker build -t dynamic-event-map-events-ingest:latest -f (Join-Path $ProjectRoot "infra\ingest\Dockerfile") (Join-Path $ProjectRoot "infra\ingest")
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [FAIL] Events Ingest build failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] Events Ingest image built" -ForegroundColor Green
    Write-Host ""
}

# Deploy stack
Write-Host "[7/8] Deploying stack..." -ForegroundColor Yellow
$ComposeFile = Join-Path $ProjectRoot "docker-compose.swarm-local.yml"
docker stack deploy -c $ComposeFile eventmap --with-registry-auth
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Stack deployment failed" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Stack deployed successfully" -ForegroundColor Green
Write-Host ""

# Wait for services to be ready
Write-Host "[8/8] Waiting for services to start..." -ForegroundColor Yellow
Write-Host "This may take 30-60 seconds..." -ForegroundColor Gray
Start-Sleep -Seconds 5

$MaxWait = 60
$Elapsed = 0
$Interval = 5

while ($Elapsed -lt $MaxWait) {
    $Services = docker service ls --format '{{.Name}} {{.Replicas}}' --filter name=eventmap
    $AllReady = $true
    
    foreach ($Service in $Services) {
        if ($Service -match '^eventmap_events_ingest') {
            # Skip ingest service (replicas: 0)
            continue
        }
        if ($Service -match '(\d+)/(\d+)$') {
            $current = [int]$matches[1]
            $desired = [int]$matches[2]
            if ($current -lt $desired) {
                $AllReady = $false
                break
            }
        }
    }
    
    # Ensure at least one service was found before marking all as ready
    if ($AllReady -and $Services.Count -gt 0) {
        Write-Host "[OK] All services are running" -ForegroundColor Green
        break
    }
    
    Start-Sleep -Seconds $Interval
    $Elapsed += $Interval
    Write-Host "  Still starting... ($Elapsed seconds elapsed)" -ForegroundColor Gray
}

if ($Elapsed -ge $MaxWait) {
    Write-Host "[WARN] Timeout waiting for services. Check status manually:" -ForegroundColor Yellow
    Write-Host "  docker service ls" -ForegroundColor Gray
}
Write-Host ""

# Display service status
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Deployment Complete!" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Service Status:" -ForegroundColor Yellow
docker service ls --filter name=eventmap
Write-Host ""

Write-Host "Access the application at:" -ForegroundColor Yellow
Write-Host "  Frontend: http://localhost" -ForegroundColor Cyan
Write-Host "  API:      http://localhost:$env:BACKEND_PORT" -ForegroundColor Cyan
Write-Host ""

Write-Host "Useful commands:" -ForegroundColor Yellow
Write-Host "  View logs:     docker service logs -f eventmap_<service_name>" -ForegroundColor Gray
Write-Host "  Scale service: docker service scale eventmap_<service_name>=<replicas>" -ForegroundColor Gray
Write-Host "  List services: docker service ls" -ForegroundColor Gray
Write-Host "  Remove stack:  docker stack rm eventmap" -ForegroundColor Gray
Write-Host ""
