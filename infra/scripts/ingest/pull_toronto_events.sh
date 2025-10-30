#!/usr/bin/env bash
set -euo pipefail

ROOT="/root/deploy"

if [ -f "$ROOT/.env" ]; then
  # shellcheck disable=SC1090
  set -a
  . "$ROOT/.env"
  set +a
fi

node "$ROOT/infra/scripts/ingest/update_toronto_events.js"
