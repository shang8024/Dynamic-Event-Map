#!/usr/bin/env bash
# Run manually from a clean, committed checkout. Publishes images; does not deploy.
set -euo pipefail
umask 077
: "${GH_TOKEN:?Supply a registry token with write:packages through the environment}"
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_ACTOR:?Supply the GitHub registry username}"
[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || exit 1
cd "$(git rev-parse --show-toplevel)"
[[ "$GITHUB_SHA" == "$(git rev-parse HEAD)" ]] && git diff --quiet HEAD -- && \
  [[ -z "$(git ls-files --others --exclude-standard)" ]] || {
    echo 'Build the current commit from a clean checkout; keep local configuration ignored.' >&2; exit 1;
  }
for variable in VITE_GOOGLE_MAPS_KEY VITE_GOOGLE_MAPS_MAP_ID VITE_FIREBASE_API_KEY VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_APP_ID VITE_FIREBASE_MESSAGING_SENDER_ID; do
  [[ -n "${!variable:-}" ]] || { echo "Configure $variable in the production environment" >&2; exit 1; }
done
export VITE_FIREBASE_AUTH_DOMAIN="${VITE_FIREBASE_AUTH_DOMAIN:-$VITE_FIREBASE_PROJECT_ID.firebaseapp.com}"
export VITE_FIREBASE_STORAGE_BUCKET="${VITE_FIREBASE_STORAGE_BUCKET:-$VITE_FIREBASE_PROJECT_ID.firebasestorage.app}"
IMAGE_PREFIX="ghcr.io/${GITHUB_REPOSITORY,,}-production"
mkdir -p release
RELEASE_FILES=$(mktemp -d "$PWD/release/.files.XXXXXXXX")
# shellcheck disable=SC2329 # Invoked by the EXIT trap.
cleanup() {
  docker logout ghcr.io >/dev/null 2>&1 || true
  rm -rf -- "$RELEASE_FILES"
}
trap cleanup EXIT
printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
unset GH_TOKEN
printf 'IMAGE_PREFIX=%s\nIMAGE_TAG=%s\n' "$IMAGE_PREFIX" "$GITHUB_SHA" > "$RELEASE_FILES/release.env"
: > "$RELEASE_FILES/images.lock"
for pair in api:api events-ingest:infra/ingest db-backup:infra/backup client:client; do
  component="${pair%%:*}"; context="${pair#*:}"
  arguments=()
  if [[ "$component" == client ]]; then
    export VITE_API_BASE_URL=/api
    for name in VITE_API_BASE_URL VITE_GOOGLE_MAPS_KEY VITE_GOOGLE_MAPS_MAP_ID VITE_FIREBASE_API_KEY VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_STORAGE_BUCKET VITE_FIREBASE_APP_ID VITE_FIREBASE_MESSAGING_SENDER_ID; do
      arguments+=(--build-arg "$name")
    done
  fi
  docker buildx build --platform linux/amd64 --push --provenance=false \
    --metadata-file "release/$component.metadata.json" \
    --label "org.opencontainers.image.source=https://github.com/$GITHUB_REPOSITORY" \
    --label "org.opencontainers.image.revision=$GITHUB_SHA" \
    --label "io.dynamic-event-map.image-prefix=$IMAGE_PREFIX" \
    --tag "$IMAGE_PREFIX-$component:$GITHUB_SHA" "${arguments[@]}" "$context"
  digest=$(jq -er '.["containerimage.digest"]' "release/$component.metadata.json")
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
  printf '%s=%s\n' "$component" "$digest" >> "$RELEASE_FILES/images.lock"
done
# Export only committed paths, excluding local credentials and generated files.
git archive "$GITHUB_SHA" -- stack.yml stack.notifications.yml stack.notifications.identity.yml \
  db infra/scripts infra/system infra/env/.env.production.example | tar -xf - -C "$RELEASE_FILES"
tar -czf release/eventmap-release.tar.gz -C "$RELEASE_FILES" \
  release.env images.lock stack.yml stack.notifications.yml stack.notifications.identity.yml \
  db infra/scripts infra/system infra/env/.env.production.example
printf 'Published %s at commit %s. Bundle: release/eventmap-release.tar.gz; no server was changed.\n' "$IMAGE_PREFIX" "$GITHUB_SHA"
