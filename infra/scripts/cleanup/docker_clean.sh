# /usr/local/bin/docker-clean.sh
#!/usr/bin/env bash
set -euo pipefail

DRY_RUN="${DRY_RUN:-false}"

KEEP_HOURS="${KEEP_HOURS:-168}"   # 7 days

STOPPED_KEEP_HOURS="${STOPPED_KEEP_HOURS:-24}"

LOG_DIR="/var/log/docker-clean"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date +'%Y%m%d-%H%M%S').log"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "== $(date -Is) docker-clean start =="
echo "DRY_RUN=$DRY_RUN, KEEP_HOURS=$KEEP_HOURS, STOPPED_KEEP_HOURS=$STOPPED_KEEP_HOURS"

echo "[Info] Docker disk usage before cleanup:"
docker system df || true

echo "[Info] current running containers:"
docker ps --format 'table {{.ID}}\t{{.Image}}\t{{.Names}}\t{{.Status}}'

if docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -qi active; then
  echo "[Info] Swarm is active. Current services:"
  docker service ls
fi

run() {
  if [ "$DRY_RUN" = "true" ]; then
    echo "[DRY] $*"
  else
    echo "[RUN] $*"
    eval "$@"
  fi
}

echo "cleaning up everything stopped or unused (older than ${STOPPED_KEEP_HOURS} hours):"
run "docker system prune -a -f --filter \"until=${STOPPED_KEEP_HOURS}h\""

echo "cleanup system caches:"
run "apt-get clean || true"
run "journalctl --vacuum-size=100M || true"

echo "[Info] Docker disk usage after cleanup:"
docker system df || true

echo "== $(date -Is) docker-clean end =="
