#!/usr/bin/env bash
# CI calls this reviewed bootstrap with a temporary, host-verified SSH session.
set -euo pipefail
umask 077
[[ "$EUID" == 0 && "$#" == 3 ]] || { echo 'Root and SHA, image prefix, bundle digest are required' >&2; exit 1; }
SHA="$1" PREFIX="$2" DIGEST="$3"
[[ "$SHA" =~ ^[a-f0-9]{40}$ && "$DIGEST" =~ ^[a-f0-9]{64}$ && "$PREFIX" =~ ^ghcr\.io/[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$ ]] || exit 1
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[[ "$HERE" =~ ^/home/[a-z_][a-z0-9_-]*/eventmap-inbound-[1-9][0-9]*-[1-9][0-9]*$ ]] || { echo 'Unexpected inbound directory' >&2; exit 1; }
[[ -f "$HERE/eventmap-release.tar.gz" && ! -L "$HERE/eventmap-release.tar.gz" && -f "$HERE/ci_deploy_lightsail.py" && ! -L "$HERE/ci_deploy_lightsail.py" ]] || exit 1
install -d -m 700 /var/lib/eventmap /var/log/eventmap-ci-deploy
# This sequence lock does not alias maintenance.lock: each existing helper takes
# its own maintenance lock, so backups/deployments never nest the same flock.
# If a host timer wins the gap, deployment fails closed without overlapping it.
[[ ! -L /var/lib/eventmap/ci-deploy.lock ]] || exit 1
exec 8>/var/lib/eventmap/ci-deploy.lock
flock -n 8 || { echo 'Another CI release sequence is active' >&2; exit 1; }
LOG="/var/log/eventmap-ci-deploy/$SHA-${HERE##*/}.log"
[[ ! -L "$LOG" ]] || exit 1
touch "$LOG";chmod 600 "$LOG"
python3 "$HERE/ci_deploy_lightsail.py" install-bundle --bundle "$HERE/eventmap-release.tar.gz" \
  --digest "$DIGEST" --sha "$SHA" --prefix "$PREFIX"
CANDIDATE="/root/eventmap-releases/$SHA"
BACKUP=/root/deploy/infra/scripts/run_swarm_job.sh
[[ -f "$BACKUP" && ! -L "$BACKUP" && "$(stat -c '%u' "$BACKUP")" == 0 ]] || { echo 'Install the reviewed backup helper first' >&2; exit 1; }
if ! JOB_TIMEOUT_SECONDS=1200 bash "$BACKUP" backup >> "$LOG" 2>&1; then
  echo "Pre-deploy backup failed; no rollout requested. Inspect $LOG on the host." >&2
  exit 1
fi
if ! bash "$CANDIDATE/infra/scripts/deploy.sh" "$PREFIX" "$SHA" "$CANDIDATE" >> "$LOG" 2>&1; then
  echo "Deployment did not pass acceptance. Previous release files are retained. Inspect $LOG on the host." >&2
  exit 1
fi
echo "DEPLOY_BUNDLE_SUCCESS commit=$SHA; protected host log: $LOG"
