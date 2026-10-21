#!/usr/bin/env bash
# Preview by default. Remove only old, unreferenced images published for this project.
set -euo pipefail
umask 077
[[ "$EUID" == 0 ]] || { echo 'Run as root (sudo)' >&2; exit 1; }
APPLY=false
case "${1:-}" in
  ''|--dry-run) ;;
  --apply) APPLY=true ;;
  *) echo 'Usage: docker_clean.sh [--dry-run|--apply]' >&2; exit 1 ;;
esac
[[ "$#" -le 1 ]] || exit 1
command -v python3 >/dev/null
exec 9>/var/lock/eventmap-maintenance.lock
flock -n 9 || { echo 'Another deployment/maintenance job is running' >&2; exit 1; }
python3 - "$APPLY" <<'PY'
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys

COMPONENTS = {'api', 'client', 'events-ingest', 'db-backup'}
DIGEST = re.compile(r'sha256:[a-f0-9]{64}')
PREFIX = re.compile(r'ghcr\.io/[a-z0-9._-]+/[a-z0-9._/-]+')

def fail(message):
    raise RuntimeError(message)

def docker(*args):
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=60)
    if result.returncode:
        fail('Docker inspection/removal failed; no further cleanup: ' + ' '.join(args[:2]))
    return result.stdout

def inspect(kind, identifiers):
    records = []
    for offset in range(0, len(identifiers), 50):
        records.extend(json.loads(docker(kind, 'inspect', *identifiers[offset:offset + 50])))
    return records

def release(env_path, lock_path):
    values = {}
    for line in env_path.read_text().splitlines():
        key, sep, value = line.partition('=')
        if not sep or key not in {'IMAGE_PREFIX', 'IMAGE_TAG'} or key in values:
            fail('Invalid release environment record: ' + str(env_path))
        values[key] = value
    if not PREFIX.fullmatch(values.get('IMAGE_PREFIX', '')) or not re.fullmatch(r'[a-f0-9]{40}', values.get('IMAGE_TAG', '')):
        fail('Invalid release identity: ' + str(env_path))
    digests = {}
    for line in lock_path.read_text().splitlines():
        component, _, digest = line.partition('=')
        if component not in COMPONENTS or component in digests or not DIGEST.fullmatch(digest):
            fail('Invalid accepted image manifest: ' + str(lock_path))
        digests[component] = digest
    if set(digests) != COMPONENTS:
        fail('Incomplete accepted image manifest: ' + str(lock_path))
    refs = {f'{values["IMAGE_PREFIX"]}-{name}@{digest}' for name, digest in digests.items()}
    refs |= {f'{values["IMAGE_PREFIX"]}-{name}:{values["IMAGE_TAG"]}' for name in COMPONENTS}
    return values['IMAGE_PREFIX'], refs

def normalized_refs(ref):
    result = {ref}
    if '@' in ref:
        repository, digest = ref.rsplit('@', 1)
        result.add(repository.split(':', 1)[0] + '@' + digest)
    return result

def protected_refs():
    protected = set()
    containers = docker('container', 'ls', '-aq', '--no-trunc').split()
    for item in inspect('container', containers):
        protected.add(item['Image'])
    services = docker('service', 'ls', '-q').split()
    for item in inspect('service', services):
        for field in ('Spec', 'PreviousSpec'):
            ref = item.get(field, {}).get('TaskTemplate', {}).get('ContainerSpec', {}).get('Image')
            if ref:
                protected.update(normalized_refs(ref))
    return protected

try:
    hours = os.environ.get('KEEP_HOURS', '168')
    maximum = os.environ.get('MAX_IMAGES', '10')
    if not hours.isdigit() or not 168 <= int(hours) <= 87600:
        fail('KEEP_HOURS must be between 168 and 87600')
    if not maximum.isdigit() or not 1 <= int(maximum) <= 10:
        fail('MAX_IMAGES must be between 1 and 10')
    root = Path('/root/deploy')
    prefix, accepted = release(root / '.release.env', root / '.release.images.lock')
    previous_env, previous_lock = root / '.release.previous.env', root / '.release.previous.images.lock'
    if previous_env.exists() or previous_lock.exists():
        accepted |= release(previous_env, previous_lock)[1]
    # Also retain the latest two immutable accepted bundles, even after a rollback.
    bundles = Path('/root/eventmap-accepted-releases')
    if bundles.exists():
        recent = sorted((p for p in bundles.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime, reverse=True)[:2]
        for bundle in recent:
            accepted |= release(bundle / '.release.env', bundle / 'images.lock')[1]
    images = inspect('image', sorted(set(docker('image', 'ls', '-aq', '--no-trunc').split())))
    protected = protected_refs() | accepted
    repositories = {prefix + '-' + component for component in COMPONENTS}
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=int(hours))
    candidates = []
    for item in images:
        identity = item['Id']
        refs = set(item.get('RepoTags') or []) | set(item.get('RepoDigests') or [])
        labels = item.get('Config', {}).get('Labels') or {}
        if labels.get('io.dynamic-event-map.image-prefix') != prefix or not refs:
            continue
        if any(ref.split('@', 1)[0].split(':', 1)[0] not in repositories for ref in refs):
            continue  # Never delete an ID also tagged for another project.
        if identity in protected or refs & protected:
            continue
        created = dt.datetime.fromisoformat(item['Created'].replace('Z', '+00:00'))
        if created >= cutoff:
            continue
        if not DIGEST.fullmatch(identity):
            fail('Unexpected image identifier')
        candidates.append((created, identity))
    candidates.sort()
    for _, identity in candidates[:int(maximum)]:
        # Reinspect service/container references immediately before each deletion.
        current = inspect('image', [identity])[0]
        refs = set(current.get('RepoTags') or []) | set(current.get('RepoDigests') or [])
        labels = current.get('Config', {}).get('Labels') or {}
        if labels.get('io.dynamic-event-map.image-prefix') != prefix or not refs or any(ref.split('@', 1)[0].split(':', 1)[0] not in repositories for ref in refs):
            print('KEEP changed ownership ' + identity)
            continue
        protected = protected_refs() | accepted
        if identity in protected or refs & protected:
            print('KEEP newly referenced ' + identity)
            continue
        if sys.argv[1] == 'true':
            docker('image', 'rm', identity)  # No force; Docker refuses referenced/conflicting IDs.
            print('REMOVED ' + identity)
        else:
            print('DRY_RUN eligible ' + identity)
    print(f'CLEANUP_COMPLETE mode={"apply" if sys.argv[1] == "true" else "dry-run"} eligible={len(candidates)} limit={maximum}')
except (RuntimeError, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
    print('Cleanup stopped: ' + str(error), file=sys.stderr)
    sys.exit(1)
PY
