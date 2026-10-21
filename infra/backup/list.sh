#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/common.sh"
configure_storage
# The checksum marker is published only after backup.sh verifies the upload.
# Listing uses that completion marker; restore.sh rechecks the archive bytes.
rclone lsf "backup:$S3_BUCKET/$S3_PREFIX" --files-only --include '*.dump.sha256' |
  sed -nE 's/^(backup_[a-zA-Z0-9_]+_[a-zA-Z0-9_]+\.dump)\.sha256$/\1/p' | sort -r
