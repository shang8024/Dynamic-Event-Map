#!/usr/bin/env bash
set -euo pipefail
umask 077
# One host lock covers manual jobs, Actions, systemd and deployments.
exec 9>/var/lock/eventmap-maintenance.lock
flock -n 9 || { echo "Another deployment/maintenance job is running" >&2; exit 1; }
JOB="${1:-}"
JOB_TIMEOUT_SECONDS="${JOB_TIMEOUT_SECONDS:-1200}"
[[ "$JOB_TIMEOUT_SECONDS" =~ ^[1-9][0-9]{0,4}$ ]] || exit 1
EXTRA_ENV=()
case "$JOB" in
  backup) SERVICE=eventmap_db_backup ;;
  list) SERVICE=eventmap_db_backup; EXTRA_ENV+=(--env-add BACKUP_LIST_ONLY=true) ;;
  ingest) SERVICE=eventmap_events_ingest ;;
  restore)
    SERVICE=eventmap_db_restore
    BACKUP_FILE="${2:-}"; TARGET="${3:-}"
    [[ "$BACKUP_FILE" =~ ^backup_[a-zA-Z0-9_]+_[a-zA-Z0-9_]+\.dump$ ]] || { echo "Invalid backup basename" >&2; exit 1; }
    [[ "$TARGET" =~ ^recovery_[a-z0-9_]{1,54}$ ]] || { echo "Use a new recovery_ database name" >&2; exit 1; }
    EXTRA_ENV+=(--env-add "BACKUP_FILE=$BACKUP_FILE" --env-add "RESTORE_DB_NAME=$TARGET" --env-add "RESTORE_CONFIRM_TARGET=$TARGET")
    ;;
  *) echo "Usage: $0 backup|list|ingest|restore [backup_basename recovery_target]" >&2; exit 1 ;;
esac
[[ "$(docker service inspect -f '{{.Spec.Mode.Replicated.Replicas}}' "$SERVICE")" == 0 ]] || {
  echo "Job service must be idle at zero replicas; inspect any active job first" >&2; exit 1;
}
if [[ "$JOB" == restore ]]; then
  mapfile -t DB_CONTAINERS < <(docker ps -q --filter label=com.docker.swarm.service.name=eventmap_db)
  [[ "${#DB_CONTAINERS[@]}" == 1 ]] || { echo "Expected exactly one local database task" >&2; exit 1; }
  # createdb refuses an existing target. Failed recovery DBs are retained for inspection.
  docker exec -e "TARGET_DB=$TARGET" "${DB_CONTAINERS[0]}" sh -ec \
    'export PGPASSWORD="$(cat /run/secrets/pg_password)"; exec createdb -U "$POSTGRES_USER" "$TARGET_DB"'
fi
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM"
cleanup() {
  local result=$?
  trap - EXIT
  if ! docker service update --detach=true --replicas 0 "$SERVICE" >/dev/null; then result=1; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
docker service update --detach=true --force --replicas 1 \
  --env-rm BACKUP_LIST_ONLY --env-add "JOB_RUN_ID=$RUN_ID" "${EXTRA_ENV[@]}" "$SERVICE" >/dev/null
DEADLINE=$((SECONDS + JOB_TIMEOUT_SECONDS))
TASK_ID=""
while ((SECONDS < DEADLINE)); do
  if [[ -z "$TASK_ID" ]]; then
    while IFS= read -r candidate; do
      if docker inspect -f '{{range .Spec.ContainerSpec.Env}}{{println .}}{{end}}' "$candidate" | grep -Fxq "JOB_RUN_ID=$RUN_ID"; then
        TASK_ID="$candidate"; break
      fi
    done < <(docker service ps -q --no-trunc "$SERVICE")
  fi
  if [[ -n "$TASK_ID" ]]; then
    STATE=$(docker inspect -f '{{.Status.State}}' "$TASK_ID")
    case "$STATE" in
      complete)
        CODE=$(docker inspect -f '{{.Status.ContainerStatus.ExitCode}}' "$TASK_ID")
        docker service logs --raw "$TASK_ID"
        [[ "$CODE" == 0 ]] || exit 1
        install -d -m 700 /var/lib/eventmap/job-status
        date -u +%FT%TZ > "/var/lib/eventmap/job-status/$JOB.last-success"
        echo "JOB_SUCCESS job=$JOB task=$TASK_ID"
        exit 0 ;;
      failed|rejected|orphaned|shutdown)
        docker service logs --raw "$TASK_ID" || true
        echo "Job failed: task=$TASK_ID state=$STATE" >&2; exit 1 ;;
    esac
  fi
  sleep 2
done
echo "Job timed out after $JOB_TIMEOUT_SECONDS seconds" >&2
[[ -z "$TASK_ID" ]] || docker service logs --raw "$TASK_ID" || true
exit 1
