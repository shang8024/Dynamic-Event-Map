#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$EUID" == 0 ]] || { echo "Run as root (sudo)" >&2; exit 1; }
exec 9>/var/lock/eventmap-maintenance.lock
flock -n 9 || { echo "Another deployment/maintenance job is running" >&2; exit 1; }
cd /root/deploy
[[ "$(stat -c '%u:%a' .env)" == 0:600 ]] || { echo ".env must be root-owned mode 0600" >&2; exit 1; }
set -a
. ./.env
set +a
export IMAGE_PREFIX="${1:?Supply the GHCR image prefix}"
export IMAGE_TAG="${2:?Supply the full commit SHA}"
[[ "$IMAGE_PREFIX" =~ ^ghcr\.io/[a-z0-9._/-]+$ && "$IMAGE_TAG" =~ ^[a-f0-9]{40}$ ]] || exit 1
if [[ -n "${3:-}" ]]; then
  [[ "$3" == "/root/eventmap-releases/$IMAGE_TAG" && -f "$3/stack.yml" ]] || exit 1
  # Install reviewed release files only while holding the same host job lock.
  cp "$3/stack.yml" ./stack.yml
  cp -a "$3/db" "$3/infra" ./
fi
[[ "${DOMAIN:-}" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Configure DOMAIN" >&2; exit 1; }
: "${FIREBASE_PROJECT_ID:?Configure FIREBASE_PROJECT_ID}"
[[ "$(docker info --format '{{.Swarm.LocalNodeState}}')" == active ]]
docker secret inspect pg_password redis_password s3_access_key s3_secret_key >/dev/null
for component in api client events-ingest db-backup; do docker pull "$IMAGE_PREFIX-$component:$IMAGE_TAG"; done
docker stack config -c stack.yml >/dev/null
docker stack deploy --with-registry-auth --resolve-image always -c stack.yml eventmap

# Check current desired tasks against the service's exact resolved image.
# An older healthy HTTP response alone must not pass a failed rollout.
converged() {
  local service expected wanted ids task state actual count
  for service in traefik db redis api client; do
    expected=$(docker service inspect -f '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "eventmap_$service")
    wanted=$(docker service inspect -f '{{.Spec.Mode.Replicated.Replicas}}' "eventmap_$service")
    if [[ "$service" == api || "$service" == client ]]; then
      [[ "$expected" == "$IMAGE_PREFIX-$service:$IMAGE_TAG@sha256:"* ]] || return 1
    fi
    ids=$(docker service ps -q --no-trunc --filter desired-state=running "eventmap_$service")
    count=0
    for task in $ids; do
      state=$(docker inspect -f '{{.Status.State}}' "$task")
      actual=$(docker inspect -f '{{.Spec.ContainerSpec.Image}}' "$task")
      [[ "$state" == running && "$actual" == "$expected" ]] || return 1
      count=$((count + 1))
    done
    [[ "$count" == "$wanted" && "$count" -gt 0 ]] || return 1
  done
}
for attempt in $(seq 1 90); do
  if converged && curl --fail --silent --show-error --max-time 5 "https://www.$DOMAIN/api/healthz" >/dev/null; then
    printf 'IMAGE_PREFIX=%s\nIMAGE_TAG=%s\n' "$IMAGE_PREFIX" "$IMAGE_TAG" > .release.env.next
    if [[ -f .release.env ]]; then cp .release.env .release.previous.env; fi
    mv .release.env.next .release.env
    docker service ls
    echo "DEPLOY_SUCCESS image_tag=$IMAGE_TAG; run the live acceptance checks in docs/OPERATIONS.md"
    exit 0
  fi
  sleep 5
done
echo "Release did not converge within the deadline. Inspect tasks and use the recorded previous release for rollback." >&2
exit 1
