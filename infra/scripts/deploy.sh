#!/usr/bin/env bash
# Manual single-host deployment of a reviewed CI release bundle, by immutable digest.
set -euo pipefail
umask 077
[[ "$EUID" == 0 ]] || { echo 'Run as root (sudo)' >&2; exit 1; }
exec 9>/var/lock/eventmap-maintenance.lock
flock -n 9 || { echo 'Another deployment/maintenance job is running' >&2; exit 1; }
cd /root/deploy
[[ "$(stat -c '%u:%a' .env)" == 0:600 ]] || { echo '.env must be root-owned mode0600' >&2; exit 1; }
set -a
# shellcheck disable=SC1091 # Protected host configuration, deliberately absent from the repository.
. ./.env
set +a
export IMAGE_PREFIX="${1:?Supply the GHCR image prefix}"
export IMAGE_TAG="${2:?Supply the full commit SHA}"
[[ "$IMAGE_PREFIX" =~ ^ghcr\.io/[a-z0-9._/-]+$ && "$IMAGE_TAG" =~ ^[a-f0-9]{40}$ ]] || exit 1
CANDIDATE="${3:-/root/eventmap-releases/$IMAGE_TAG}"
[[ "$CANDIDATE" == "/root/eventmap-releases/$IMAGE_TAG" && -f "$CANDIDATE/stack.yml" && -f "$CANDIDATE/images.lock" ]] || {
  echo 'Extract the complete reviewed release bundle under /root/eventmap-releases/<commit> first' >&2; exit 1;
}
[[ "${DOMAIN:-}" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo 'Configure DOMAIN' >&2; exit 1; }
: "${FIREBASE_PROJECT_ID:?Configure FIREBASE_PROJECT_ID}"
[[ "$(docker info --format '{{.Swarm.LocalNodeState}}')" == active ]]
docker secret inspect pg_password redis_password s3_access_key s3_secret_key unsubscribe_signing_secret >/dev/null
declare -A DIGESTS=()
while IFS='=' read -r component digest || [[ -n "$component" ]]; do
  [[ "$component" =~ ^(api|client|events-ingest|db-backup)$ && "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid image digest record' >&2; exit 1; }
  [[ -z "${DIGESTS[$component]:-}" ]] || { echo 'Duplicate image digest record' >&2; exit 1; }
  DIGESTS[$component]="$digest"
done < "$CANDIDATE/images.lock"
[[ "${#DIGESTS[@]}" == 4 ]] || { echo 'Four component digests are required' >&2; exit 1; }
ACCEPTED="/root/eventmap-accepted-releases/$IMAGE_TAG"
if [[ -f "$ACCEPTED/images.lock" ]] && ! cmp -s "$CANDIDATE/images.lock" "$ACCEPTED/images.lock"; then
  echo 'This commit already has a different accepted digest set. Keep the accepted release immutable; publish a new commit.' >&2; exit 1
fi
STACK_ARGS=(-c "$CANDIDATE/stack.yml")
if [[ "${NOTIFICATIONS_CONFIGURED:-false}" == true ]]; then
  docker secret inspect ses_access_key ses_secret_key >/dev/null
  STACK_ARGS+=(-c "$CANDIDATE/stack.notifications.yml")
fi
if [[ "${NOTIFICATION_IDENTITY_CONFIGURED:-false}" == true ]]; then
  [[ "${NOTIFICATIONS_CONFIGURED:-false}" == true ]] || exit 1
  docker secret inspect firebase_notifications >/dev/null
  STACK_ARGS+=(-c "$CANDIDATE/stack.notifications.identity.yml")
fi
WORK=$(mktemp -d /root/deploy/.release-check.XXXXXXXX)
# shellcheck disable=SC2329 # Invoked by the EXIT trap.
cleanup() { rm -f -- "$WORK/images.yml"; rmdir -- "$WORK"; }
trap cleanup EXIT
{
  printf 'version: "3.9"\nservices:\n'
  for component in api client events-ingest db-backup; do
    service="${component//-/_}"
    printf '  %s:\n    image: %s-%s@%s\n' "$service" "$IMAGE_PREFIX" "$component" "${DIGESTS[$component]}"
  done
  printf '  db_restore:\n    image: %s-db-backup@%s\n' "$IMAGE_PREFIX" "${DIGESTS[db-backup]}"
  printf '  image_proxy:\n    image: %s-api@%s\n' "$IMAGE_PREFIX" "${DIGESTS[api]}"
  if [[ "${NOTIFICATIONS_CONFIGURED:-false}" == true ]]; then
    printf '  notifications:\n    image: %s-api@%s\n' "$IMAGE_PREFIX" "${DIGESTS[api]}"
  fi
} > "$WORK/images.yml"
STACK_ARGS+=(-c "$WORK/images.yml")
docker stack config "${STACK_ARGS[@]}" >/dev/null

# Explicit migration gate: never run candidate SQL automatically or accept a changed applied migration.
for migration in "$CANDIDATE"/db/migrations/[0-9]*.sql; do
  name=$(basename "$migration" .sql)
  ledger="/var/lib/eventmap/migrations/$name.applied"
  [[ -s "$ledger" ]] || { echo "Apply and record $name manually after a verified recovery rehearsal (README.md)" >&2; exit 1; }
  expected=$(grep -Eo '^[a-f0-9]{64}' "$ledger" | sort -u)
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || { echo "Ambiguous migration ledger: $name" >&2; exit 1; }
  actual=$(sha256sum "$migration" | awk '{print $1}')
  [[ "$expected" == "$actual" ]] || { echo "Applied migration checksum differs: $name" >&2; exit 1; }
done
mapfile -t DB_TASKS < <(docker ps -q --filter label=com.docker.swarm.service.name=eventmap_db)
[[ "${#DB_TASKS[@]}" == 1 ]] || { echo 'Expected one running database container' >&2; exit 1; }
schema_ready=$(docker exec "${DB_TASKS[0]}" sh -ec '
  export PGPASSWORD="$(cat /run/secrets/pg_password)" PGOPTIONS="-c statement_timeout=5000"
  exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT to_regclass('\''public.notification_outbox'\'') IS NOT NULL AND to_regclass('\''public.notification_preferences'\'') IS NOT NULL AND to_regclass('\''public.in_app_notifications'\'') IS NOT NULL AND to_regclass('\''public.realtime_outbox'\'') IS NOT NULL AND to_regclass('\''public.event_ingest_state'\'') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='\''public'\'' AND table_name='\''events'\'' AND column_name='\''archived_at'\'') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='\''public'\'' AND table_name='\''profiles'\'' AND column_name='\''role'\'') AND to_regclass('\''public.ux_events_natural_all'\'') IS NULL AND to_regprocedure('\''refresh_toronto_occurrences(text[],timestamp with time zone)'\'') IS NOT NULL AND to_regprocedure('\''cleanup_expired_events(timestamp with time zone)'\'') IS NOT NULL;"
')
[[ "$schema_ready" == t ]] || { echo 'Required database migrations are not installed; see README.md' >&2; exit 1; }
for component in api client events-ingest db-backup; do
  docker pull "$IMAGE_PREFIX-$component@${DIGESTS[$component]}" || {
    echo 'Cannot pull release digest. Verify GHCR package visibility or the host read-only registry login.' >&2; exit 1;
  }
done

# Preserve the previous configuration before submitting a rollout. Pull/config/schema failures above change no host release files.
PREVIOUS="/root/eventmap-release-history/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 700 "$PREVIOUS"
for item in stack.yml stack.notifications.yml stack.notifications.identity.yml db infra .release.env .release.images.lock .release.images.yml; do
  [[ ! -e "$item" ]] || cp -a "$item" "$PREVIOUS/"
done
: > "$PREVIOUS/service-images.txt"
for service in eventmap_api eventmap_client eventmap_image_proxy eventmap_events_ingest eventmap_db_backup; do
  if docker service inspect "$service" >/dev/null 2>&1; then
    docker service inspect -f '{{.Spec.Name}} {{.Spec.TaskTemplate.ContainerSpec.Image}}' "$service" >> "$PREVIOUS/service-images.txt"
  fi
done
docker stack deploy --with-registry-auth --resolve-image never "${STACK_ARGS[@]}" eventmap
converged() {
  local service component expected count task
  for service in traefik db redis api client image_proxy; do
    expected=$(docker service inspect -f '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "eventmap_$service")
    if [[ "$service" == api || "$service" == client ]]; then
      [[ "$expected" == "$IMAGE_PREFIX-$service@${DIGESTS[$service]}" ]] || return 1
    fi
    if [[ "$service" == image_proxy ]]; then
      [[ "$expected" == "$IMAGE_PREFIX-api@${DIGESTS[api]}" ]] || return 1
    fi
    count=0
    while IFS= read -r task; do
      [[ -n "$task" && "$(docker inspect -f '{{.Status.State}} {{.Spec.ContainerSpec.Image}}' "$task")" == "running $expected" ]] || return 1
      count=$((count+1))
    done < <(docker service ps -q --no-trunc --filter desired-state=running "eventmap_$service")
    [[ "$count" == "$(docker service inspect -f '{{.Spec.Mode.Replicated.Replicas}}' "eventmap_$service")" && "$count" -gt 0 ]] || return 1
  done
}
for _ in $(seq 1 90); do
  if converged && curl --fail --silent --show-error --max-time 5 "https://www.$DOMAIN/api/readyz" >/dev/null; then
    # Promote only an accepted rollout; a failed rollout keeps operational scripts at their previous revision.
    cp "$CANDIDATE"/stack*.yml ./
    cp -a "$CANDIDATE/db" "$CANDIDATE/infra" ./
    [[ ! -f .release.env ]] || cp .release.env .release.previous.env
    [[ ! -f .release.images.lock ]] || cp .release.images.lock .release.previous.images.lock
    cp "$CANDIDATE/images.lock" .release.images.lock
    cp "$WORK/images.yml" .release.images.yml
    printf 'IMAGE_PREFIX=%s\nIMAGE_TAG=%s\n' "$IMAGE_PREFIX" "$IMAGE_TAG" > .release.env
    if [[ ! -d "$ACCEPTED" ]]; then
      install -d -m 700 "$ACCEPTED"
      cp "$CANDIDATE"/stack*.yml "$CANDIDATE/images.lock" .release.env "$ACCEPTED/"
      cp -a "$CANDIDATE/db" "$CANDIDATE/infra" "$ACCEPTED/"
    fi
    echo "DEPLOY_SUCCESS commit=$IMAGE_TAG; previous configuration: $PREVIOUS; acceptance steps: README.md"
    exit 0
  fi
  sleep 5
done
echo "Rollout did not become ready. Previous scripts remain installed; inspect tasks and preserved image references in $PREVIOUS before rollback." >&2
exit 1
