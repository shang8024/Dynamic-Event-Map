#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$EUID" == 0 ]] || { echo "Run as root (sudo)" >&2; exit 1; }
DEPLOY_DIR=/root/deploy
[[ -f "$DEPLOY_DIR/stack.yml" && -f "$DEPLOY_DIR/db/init.sql" ]] || { echo "Upload the release to /root/deploy first" >&2; exit 1; }
for command in docker flock systemctl install; do command -v "$command" >/dev/null; done
[[ "$(docker info --format '{{.Swarm.LocalNodeState}}')" == active ]] || { echo "Initialize the intended single-node Swarm first" >&2; exit 1; }
docker secret inspect pg_password redis_password s3_access_key s3_secret_key unsubscribe_signing_secret >/dev/null

# Do not initialize/format disks, rotate credentials, or recursively change existing data.
install -d -m 700 /mnt/pgdata/postgres-data /mnt/pgdata/redis-data /var/lib/eventmap/job-status
PG_UID=$(docker run --rm --entrypoint id postgres:16-alpine -u postgres)
PG_GID=$(docker run --rm --entrypoint id postgres:16-alpine -g postgres)
REDIS_UID=$(docker run --rm --entrypoint id redis:7-alpine -u redis)
REDIS_GID=$(docker run --rm --entrypoint id redis:7-alpine -g redis)
chown "$PG_UID:$PG_GID" /mnt/pgdata/postgres-data
chown "$REDIS_UID:$REDIS_GID" /mnt/pgdata/redis-data
if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
  install -m 600 "$DEPLOY_DIR/infra/env/.env.production.example" "$DEPLOY_DIR/.env"
  echo "Created /root/deploy/.env from the example; configure it before deployment."
fi
[[ "$(stat -c '%u:%a' "$DEPLOY_DIR/.env")" == 0:600 ]] || { echo ".env must be root-owned mode 0600" >&2; exit 1; }

# Only these project-owned units are installed. Existing unrelated units are untouched.
install -m 644 "$DEPLOY_DIR/infra/system/backup/db-backup.service" /etc/systemd/system/eventmap-db-backup.service
install -m 644 "$DEPLOY_DIR/infra/system/backup/db-backup.timer" /etc/systemd/system/eventmap-db-backup.timer
install -m 644 "$DEPLOY_DIR/infra/system/ingest/eventmap-events-ingest.service" /etc/systemd/system/eventmap-events-ingest.service
install -m 644 "$DEPLOY_DIR/infra/system/ingest/eventmap-events-ingest.timer" /etc/systemd/system/eventmap-events-ingest.timer
systemctl daemon-reload
if [[ "${1:-}" == --enable-backup-timer ]]; then
  [[ -s /var/lib/eventmap/job-status/backup.last-success ]] || { echo "Run and verify the first off-host backup before enabling its timer" >&2; exit 1; }
  systemctl enable --now eventmap-db-backup.timer
elif [[ "${1:-}" == --enable-ingest-timer ]]; then
  [[ -s /var/lib/eventmap/job-status/ingest.last-success ]] || { echo "Run and verify the first memory-bounded ingestion before enabling its timer" >&2; exit 1; }
  systemctl enable --now eventmap-events-ingest.timer
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--enable-backup-timer|--enable-ingest-timer]" >&2; exit 1
fi
echo "Bootstrap complete. No cleanup, migration, backup or restore was started."
