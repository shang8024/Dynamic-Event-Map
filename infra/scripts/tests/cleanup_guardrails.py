"""Run in a disposable container, without a Docker socket or writable host mount."""
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import subprocess
import unittest

assert Path('/.dockerenv').exists() and os.getenv('EVENTMAP_CLEANUP_TEST') == '1'
assert not Path('/var/run/docker.sock').exists() and not Path('/root/deploy').exists()
ROOT = Path('/root/deploy')
ROOT.mkdir(parents=True)
BIN = Path('/tmp/cleanup-bin')
BIN.mkdir()
FIXTURE = Path('/tmp/cleanup-fixture.json')
CALLS = Path('/tmp/cleanup-calls.jsonl')
PREFIX = 'ghcr.io/test/eventmap'
SCRIPT = '/repo/infra/scripts/cleanup/docker_clean.sh'

def digest(number):
    return 'sha256:' + f'{number:064x}'

def image(number, **changes):
    value = {
        'Id': digest(number), 'RepoTags': [f'{PREFIX}-api:old-{number}'],
        'RepoDigests': [f'{PREFIX}-api@{digest(100 + number)}'],
        'Created': '2020-01-01T00:00:00Z',
        'Config': {'Labels': {'org.opencontainers.image.source': 'https://github.com/test/eventmap'}},
    }
    value.update(changes)
    return value

def manifest(directory, number, previous=False, bundle=False):
    suffix = '.previous' if previous else ''
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f'.release{suffix}.env').write_text(f'IMAGE_PREFIX={PREFIX}\nIMAGE_TAG={number:040x}\n')
    name = 'images.lock' if bundle else f'.release{suffix}.images.lock'
    (directory / name).write_text(''.join(f'{part}={digest(100 + number)}\n' for part in ('api', 'client', 'events-ingest', 'db-backup')))

(BIN / 'docker').write_text('''#!/usr/bin/env python3
import json, sys
from pathlib import Path
args = sys.argv[1:]
calls = Path('/tmp/cleanup-calls.jsonl')
history = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
with calls.open('a') as file: file.write(json.dumps(args) + '\\n')
data = json.loads(Path('/tmp/cleanup-fixture.json').read_text())
kind, operation = args[:2]
if data.get('fail_services') and kind == 'service': sys.exit(7)
if kind == 'image' and operation == 'ls': print('\\n'.join(item['Id'] for item in data['images']))
elif kind == 'image' and operation == 'inspect':
    print(json.dumps([item for item in data['images'] if item['Id'] in args[2:]]))
elif kind == 'container' and operation == 'ls':
    refs = list(data.get('containers', []))
    if data.get('race') and any(call[:2] == ['service', 'ls'] for call in history): refs += [{'Id': 'new', 'Image': data['images'][0]['Id']}]
    print('\\n'.join(item['Id'] for item in refs))
elif kind == 'container' and operation == 'inspect':
    refs = list(data.get('containers', []))
    if 'new' in args: refs += [{'Id': 'new', 'Image': data['images'][0]['Id']}]
    print(json.dumps([item for item in refs if item['Id'] in args[2:]]))
elif kind == 'service' and operation == 'ls': print('\\n'.join(item['ID'] for item in data.get('services', [])))
elif kind == 'service' and operation == 'inspect': print(json.dumps(data['services']))
elif kind == 'image' and operation == 'rm':
    assert len(args) == 3 and args[2].startswith('sha256:')
else: raise AssertionError('Unexpected Docker mutation/command: ' + repr(args))
''')
(BIN / 'docker').chmod(0o755)

class CleanupGuardrails(unittest.TestCase):
    def setUp(self):
        CALLS.unlink(missing_ok=True)
        manifest(ROOT, 5)
        manifest(ROOT, 6, previous=True)
        for number in (7, 8):
            manifest(Path('/root/eventmap-accepted-releases') / f'{number:040x}', number, bundle=True)
        self.fixture = {'images': [image(1)], 'containers': [], 'services': []}

    def run_helper(self, *args, **env):
        FIXTURE.write_text(json.dumps(self.fixture))
        return subprocess.run(['bash', SCRIPT, *args], text=True, capture_output=True,
                              env={**os.environ, 'PATH': str(BIN) + ':' + os.environ['PATH'], **env}, timeout=30)

    def removals(self):
        if not CALLS.exists(): return []
        return [entry[2] for entry in map(json.loads, CALLS.read_text().splitlines()) if entry[:2] == ['image', 'rm']]

    def test_default_preview_is_non_mutating_even_with_legacy_dry_run_false(self):
        self.fixture['images'][0]['Config']['Labels']['org.opencontainers.image.source'] = 'https://github.com/test/EventMap'
        result = self.run_helper(DRY_RUN='false')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('DRY_RUN eligible ' + digest(1), result.stdout)
        self.assertEqual(self.removals(), [])
        self.assertEqual(self.run_helper('--dry-run').returncode, 0)

    def test_apply_preserves_all_reference_classes_and_foreign_or_recent_images(self):
        self.fixture['images'] = [image(number) for number in range(1, 13)]
        self.fixture['images'][8]['Config']['Labels'] = {}  # Ownership label absent.
        self.fixture['images'][9]['RepoTags'].append('unrelated/project:keep')
        self.fixture['images'][10]['Created'] = dt.datetime.now(dt.timezone.utc).isoformat()
        self.fixture['images'][11]['RepoTags'] = ['ghcr.io/test/another-api:old']
        self.fixture['containers'] = [{'Id': 'stopped', 'Image': digest(2)}]
        self.fixture['services'] = [{
            'ID': 'zero-replica-job',
            'Spec': {'Mode': {'Replicated': {'Replicas': 0}}, 'TaskTemplate': {'ContainerSpec': {'Image': f'{PREFIX}-api:old-3@{digest(103)}'}}},
            'PreviousSpec': {'TaskTemplate': {'ContainerSpec': {'Image': f'{PREFIX}-api@{digest(104)}'}}},
        }]
        result = self.run_helper('--apply')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.removals(), [digest(1)])

    def test_at_most_ten_exact_ids(self):
        self.fixture['images'] = [image(number) for number in range(20, 35)]
        result = self.run_helper('--apply')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.removals()), 10)

    def test_new_container_reference_between_preview_and_apply_is_preserved(self):
        self.fixture['race'] = True
        result = self.run_helper('--apply')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('KEEP newly referenced', result.stdout)
        self.assertEqual(self.removals(), [])

    def test_inventory_error_fails_closed(self):
        self.fixture['fail_services'] = True
        result = self.run_helper('--apply')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.removals(), [])

    def test_missing_or_invalid_release_records_fail_closed(self):
        (ROOT / '.release.images.lock').unlink()
        result = self.run_helper('--apply')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.removals(), [])
        manifest(ROOT, 5)
        (ROOT / '.release.previous.images.lock').write_text('api=bad\n')
        self.assertNotEqual(self.run_helper('--apply').returncode, 0)

    def test_age_limit_command_injection_and_extra_arguments_rejected(self):
        for args, env in [((), {'KEEP_HOURS': '24'}), ((), {'KEEP_HOURS': '168; touch /tmp/unsafe'}), ((), {'MAX_IMAGES': '11'}), (('--apply', 'extra'), {})]:
            self.assertNotEqual(self.run_helper(*args, **env).returncode, 0)
        self.assertFalse(Path('/tmp/unsafe').exists())
        self.assertEqual(self.removals(), [])

    def test_host_maintenance_lock_prevents_cleanup(self):
        with open('/var/lock/eventmap-maintenance.lock', 'w') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_helper('--apply')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Another deployment/maintenance job', result.stderr)
        self.assertEqual(self.removals(), [])

unittest.main(verbosity=2)
