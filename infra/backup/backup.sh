#!/usr/bin/env bash
set -euo pipefail
umask 077
. "$(dirname "$0")/common.sh"
if [[ "${BACKUP_LIST_ONLY:-false}" == true ]]; then
  exec "$(dirname "$0")/list.sh"
fi
configure_database
configure_storage

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/eventmap-backup.XXXXXXXX")
trap 'rm -rf -- "$WORK_DIR"' EXIT
BACKUP_FILE="backup_${DB_NAME}_$(date -u +%Y%m%dT%H%M%SZ)_${WORK_DIR##*.}.dump"
ARCHIVE="$WORK_DIR/$BACKUP_FILE"
REMOTE="backup:$S3_BUCKET/$S3_PREFIX/$BACKUP_FILE"

echo "Creating PostgreSQL archive: $BACKUP_FILE"
pg_dump --no-owner --no-acl --format=custom --file="$ARCHIVE"
test -s "$ARCHIVE"
pg_restore --list "$ARCHIVE" >/dev/null
(cd "$WORK_DIR" && sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256")
read -r EXPECTED_HASH _ < "$ARCHIVE.sha256"

# Never report success without an off-host upload and a full read-back checksum.
rclone copyto "$ARCHIVE" "$REMOTE" --quiet
ACTUAL_HASH=$(rclone cat "$REMOTE" --quiet | sha256sum | cut -d ' ' -f 1)
[[ "$ACTUAL_HASH" == "$EXPECTED_HASH" ]] || fail "Uploaded archive checksum mismatch"
# Publish the checksum only after the archive has passed verification.
rclone copyto "$ARCHIVE.sha256" "$REMOTE.sha256" --quiet
echo "BACKUP_SUCCESS file=$BACKUP_FILE sha256=$EXPECTED_HASH"
# Retention is a bucket lifecycle policy. Runtime credentials need no DeleteObject.
