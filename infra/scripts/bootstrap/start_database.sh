#!/usr/bin/env bash
# Fresh host only: start data services before applying numbered migrations.
set -euo pipefail
umask 077
[[ "$EUID" == 0 ]] || { echo 'Run as root (sudo)' >&2; exit 1; }
cd /root/deploy
[[ -f stack.yml && -f db/init.sql && "$(stat -c '%u:%a' .env)" == 0:600 ]] || exit 1
exec 9>/var/lock/eventmap-maintenance.lock
flock -n 9 || { echo 'Another maintenance job is running' >&2; exit 1; }
if docker service inspect eventmap_db >/dev/null 2>&1; then
  echo 'Database service already exists; use the migration and normal deployment procedure' >&2; exit 1
fi
set -a
# shellcheck disable=SC1091 # Protected host configuration, deliberately absent from the repository.
. ./.env
set +a
docker secret inspect pg_password redis_password >/dev/null
WORK=$(mktemp -d /root/deploy/.database-bootstrap.XXXXXXXX)
cleanup() { rm -f -- "$WORK/full.json" "$WORK/database.json"; rmdir -- "$WORK"; }
trap cleanup EXIT
docker compose -f stack.yml config --format json > "$WORK/full.json"
python3 - "$WORK/full.json" "$WORK/database.json" <<'PY'
import json, sys
from pathlib import Path
source = json.loads(Path(sys.argv[1]).read_text())
subset = {
    'version': '3.9',
    'services': {name: source['services'][name] for name in ('db', 'redis')},
    'networks': {'internal': source['networks']['internal']},
    'volumes': {name: source['volumes'][name] for name in ('pgdata', 'dbinit', 'redisdata')},
    'secrets': {name: source['secrets'][name] for name in ('pg_password', 'redis_password')},
}
# Compose's project-name normalization is not part of the Swarm v3 schema.
for kind in ('networks', 'volumes'):
    for value in subset[kind].values():
        value.pop('name', None)
def without_nulls(value):
    if isinstance(value, dict):
        return {key: without_nulls(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [without_nulls(item) for item in value]
    return value
Path(sys.argv[2]).write_text(json.dumps(without_nulls(subset)))
PY
docker stack config -c "$WORK/database.json" >/dev/null
docker stack deploy --resolve-image always -c "$WORK/database.json" eventmap
echo 'Only PostgreSQL and Redis were requested. Wait for health, apply and record migrations, then deploy the full release using README.md.'
