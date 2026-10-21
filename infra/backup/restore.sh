#!/usr/bin/env bash
set -euo pipefail
umask 077
. "$(dirname "$0")/common.sh"

# Rehearsal/recovery only: never overwrite the live database from a workflow.
[[ "${RESTORE_DB_NAME:-}" =~ ^recovery_[a-z0-9_]{1,54}$ ]] || fail "RESTORE_DB_NAME must begin recovery_"
[[ "${RESTORE_CONFIRM_TARGET:-}" == "$RESTORE_DB_NAME" ]] || fail "Explicit target confirmation is required"
[[ "$RESTORE_DB_NAME" != "${DB_NAME:-eventsdb}" ]] || fail "Restore target is the source database"
[[ "${BACKUP_FILE:-}" =~ ^backup_[a-zA-Z0-9_]+_[a-zA-Z0-9_]+\.dump$ ]] || fail "Supply a backup basename, not a path or URL"
DB_NAME="$RESTORE_DB_NAME"
configure_database
configure_storage

# A DBA creates a dedicated empty target first. Refuse existing user objects.
OBJECTS=$(psql -X -v ON_ERROR_STOP=1 -Atc "SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') +
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') +
  (SELECT count(*) FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema'));")
[[ "$OBJECTS" == 0 ]] || fail "Restore target is not empty"

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/eventmap-restore.XXXXXXXX")
trap 'rm -rf -- "$WORK_DIR"' EXIT
ARCHIVE="$WORK_DIR/$BACKUP_FILE"
REMOTE="backup:$S3_BUCKET/$S3_PREFIX/$BACKUP_FILE"
rclone copyto "$REMOTE" "$ARCHIVE" --quiet
rclone copyto "$REMOTE.sha256" "$ARCHIVE.sha256" --quiet
[[ -s "$ARCHIVE" && -s "$ARCHIVE.sha256" ]] || fail "Downloaded backup or checksum is missing"
read -r EXPECTED_HASH EXPECTED_FILE < "$ARCHIVE.sha256"
[[ "$EXPECTED_HASH" =~ ^[a-f0-9]{64}$ && "$EXPECTED_FILE" == "$BACKUP_FILE" ]] || fail "Invalid backup checksum record"
ACTUAL_HASH=$(sha256sum "$ARCHIVE" | cut -d ' ' -f 1)
[[ "$ACTUAL_HASH" == "$EXPECTED_HASH" ]] || fail "Downloaded archive checksum mismatch"
pg_restore --list "$ARCHIVE" >/dev/null
pg_restore --dbname="$PGDATABASE" --exit-on-error --single-transaction --no-owner --no-acl "$ARCHIVE"
echo "RESTORE_SUCCESS target=$PGDATABASE file=$BACKUP_FILE"
# No live database replacement, Redis flushing, or automatic target deletion.
