#!/usr/bin/env bash
# Called only by the manual main-branch publish job. No cloud deployment occurs.
set -euo pipefail
umask 077
: "${GH_TOKEN:?GitHub supplies GITHUB_TOKEN}"
: "${GITHUB_REPOSITORY:?}"
[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || exit 1
for variable in VITE_GOOGLE_MAPS_KEY VITE_FIREBASE_API_KEY VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_APP_ID VITE_FIREBASE_MESSAGING_SENDER_ID; do
  [[ -n "${!variable:-}" ]] || { echo "Configure $variable in the production environment" >&2; exit 1; }
done
export VITE_FIREBASE_AUTH_DOMAIN="${VITE_FIREBASE_AUTH_DOMAIN:-$VITE_FIREBASE_PROJECT_ID.firebaseapp.com}"
export VITE_FIREBASE_STORAGE_BUCKET="${VITE_FIREBASE_STORAGE_BUCKET:-$VITE_FIREBASE_PROJECT_ID.firebasestorage.app}"
IMAGE_PREFIX="ghcr.io/${GITHUB_REPOSITORY,,}-production"
mkdir -p release/files
printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
unset GH_TOKEN
printf 'IMAGE_PREFIX=%s\nIMAGE_TAG=%s\n' "$IMAGE_PREFIX" "$GITHUB_SHA" > release/files/release.env
: > release/files/images.lock
for pair in api:api events-ingest:infra/ingest db-backup:infra/backup client:client; do
  component="${pair%%:*}"; context="${pair#*:}"
  arguments=()
  if [[ "$component" == client ]]; then
    export VITE_API_BASE_URL=/api
    for name in VITE_API_BASE_URL VITE_GOOGLE_MAPS_KEY VITE_FIREBASE_API_KEY VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_STORAGE_BUCKET VITE_FIREBASE_APP_ID VITE_FIREBASE_MESSAGING_SENDER_ID; do
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
  printf '%s=%s\n' "$component" "$digest" >> release/files/images.lock
done
cp stack.yml stack.notifications.yml stack.notifications.identity.yml release/files/
mkdir -p release/files/infra/env
cp -a db release/files/
cp -a infra/scripts infra/system release/files/infra/
cp infra/env/.env.production.example release/files/infra/env/
# An explicit allowlist prevents local snapshots, credentials and dependencies entering a release.
tar -czf release/eventmap-release.tar.gz -C release/files \
  release.env images.lock stack.yml stack.notifications.yml stack.notifications.identity.yml \
  db infra/scripts infra/system infra/env/.env.production.example
printf 'Published %s at commit %s. Download the release bundle and deploy it manually; no server was changed.\n' "$IMAGE_PREFIX" "$GITHUB_SHA"
