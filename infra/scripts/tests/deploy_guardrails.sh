#!/usr/bin/env bash
# Run only in a fresh disposable container: no Docker socket or host-write mount.
set -euo pipefail
[[ -f /.dockerenv && "${EVENTMAP_DEPLOY_TEST:-}" == 1 && ! -e /root/deploy ]] || exit 90
scenario="${1:?}"
commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export FIXTURE_CANDIDATE="/root/eventmap-releases/$commit"
mkdir -p /root/deploy/infra "$FIXTURE_CANDIDATE"/{db/migrations,infra} /var/lib/eventmap/migrations /tmp/bin
printf old > /root/deploy/infra/marker
printf new > "$FIXTURE_CANDIDATE/infra/marker"
printf 'DOMAIN=example.test\nFIREBASE_PROJECT_ID=test-project\n' > /root/deploy/.env
chmod 600 /root/deploy/.env
printf 'version: "3.9"\nservices: {}\n' > "$FIXTURE_CANDIDATE/stack.yml"
for migration in 001_ingestion_identity 002_notifications 003_event_management 004_realtime_notifications 005_ingest_maintenance 006_event_occurrences 007_ingest_alerts; do
  printf 'SELECT 1;\n' > "$FIXTURE_CANDIDATE/db/migrations/$migration.sql"
  sha256sum "$FIXTURE_CANDIDATE/db/migrations/$migration.sql" > "/var/lib/eventmap/migrations/$migration.applied"
done
for component in api client events-ingest db-backup; do printf '%s=sha256:%064d\n' "$component" 1; done > "$FIXTURE_CANDIDATE/images.lock"
cat > /tmp/bin/docker <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1 $2" >> /tmp/docker-calls
image() {
  case "$1" in
    eventmap_api|eventmap_client) printf 'ghcr.io/test/eventmap-%s@sha256:%064d' "${1#eventmap_}" 1 ;;
    eventmap_image_proxy) printf 'ghcr.io/test/eventmap-api@sha256:%064d' 1 ;;
    eventmap_events_ingest) printf 'ghcr.io/test/eventmap-events-ingest@sha256:%064d' 1 ;;
    eventmap_db_backup) printf 'ghcr.io/test/eventmap-db-backup@sha256:%064d' 1 ;;
    *) printf '%s:test' "$1" ;;
  esac
}
last="${!#}"
case "$1 $2" in
  'info --format') echo active ;;
  'secret inspect'|'stack config') ;;
  'ps -q') echo db-task ;;
  'exec db-task') echo t ;;
  'pull '*) [[ "${FAIL_STAGE:-}" != pull ]] ;;
  'stack deploy') touch /tmp/submitted ;;
  'service inspect')
    if [[ "$3" != -f ]]; then [[ -f /tmp/submitted ]]; exit; fi
    case "$4" in
      *Replicas*) echo 1 ;;
      *Spec.Name*) printf '%s ' "$last"; image "$last"; echo ;;
      *) image "$last"; echo ;;
    esac ;;
  'service ps') printf '%s-task\n' "$last" ;;
  'inspect -f') printf 'running '; image "${last%-task}"; echo ;;
  *) echo "Unexpected Docker call: $1 $2" >&2; exit 92 ;;
esac
MOCK
cat > /tmp/bin/curl <<'MOCK'
#!/usr/bin/env bash
[[ "${FAIL_STAGE:-}" != readiness ]]
MOCK
printf '#!/bin/sh\nexit 0\n' > /tmp/bin/sleep
printf '#!/bin/sh\nprintf "1\\n2\\n"\n' > /tmp/bin/seq
chmod +x /tmp/bin/*
export PATH="/tmp/bin:$PATH"
case "$scenario" in
  invalid_digest) printf 'api=not-a-digest\n' > "$FIXTURE_CANDIDATE/images.lock" ;;
  missing_migration) rm /var/lib/eventmap/migrations/002_notifications.applied ;;
  changed_migration) printf 'SELECT 2;\n' >> "$FIXTURE_CANDIDATE/db/migrations/002_notifications.sql" ;;
  immutable_commit)
    mkdir -p "/root/eventmap-accepted-releases/$commit"
    printf 'different\n' > "/root/eventmap-accepted-releases/$commit/images.lock" ;;
  pull_failure) export FAIL_STAGE=pull ;;
  readiness_failure) export FAIL_STAGE=readiness ;;
  fresh_success) ;;
  *) exit 91 ;;
esac
set +e
bash /repo/infra/scripts/deploy.sh ghcr.io/test/eventmap "$commit" "$FIXTURE_CANDIDATE" > /tmp/result.log 2>&1
result=$?
set -e
if [[ "$scenario" == fresh_success ]]; then
  [[ "$result" == 0 && "$(cat /root/deploy/infra/marker)" == new && -f "/root/eventmap-accepted-releases/$commit/images.lock" ]] || { cat /tmp/result.log; exit 1; }
else
  [[ "$result" != 0 && "$(cat /root/deploy/infra/marker)" == old ]] || { cat /tmp/result.log; exit 1; }
  if [[ "$scenario" != readiness_failure ]]; then [[ ! -e /tmp/submitted ]]; fi
fi
echo "PASS deployment guardrail: $scenario"
