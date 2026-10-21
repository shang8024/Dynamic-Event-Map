#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/common.sh"
configure_storage
rclone lsf "backup:$S3_BUCKET/$S3_PREFIX" --files-only --include '*.dump.sha256' | sort -r
