"""Check production Nginx headers in a disposable, loopback-only container."""
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

repo = Path(__file__).resolve().parents[3]
image = os.environ.get('EVENTMAP_NGINX_TEST_IMAGE', 'nginx:alpine')
name = 'eventmap-header-test-' + uuid.uuid4().hex[:12]


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, timeout=90).strip()


def check_headers(response):
    headers = response.headers
    policy = headers['Content-Security-Policy']
    scripts = next(part.strip() for part in policy.split(';') if part.strip().startswith('script-src '))
    assert "'unsafe-inline'" not in scripts
    assert 'https://maps.googleapis.com' in scripts
    assert 'https://apis.google.com' in scripts
    for directive in ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "script-src-attr 'none'"]:
        assert directive in policy
    assert headers['X-Content-Type-Options'] == 'nosniff'
    assert headers['X-Frame-Options'] == 'DENY'
    assert headers['Referrer-Policy'] == 'strict-origin-when-cross-origin'
    assert headers['Cross-Origin-Opener-Policy'] == 'same-origin-allow-popups'
    assert headers['Strict-Transport-Security'] == 'max-age=31536000'
    assert 'geolocation=(self)' in headers['Permissions-Policy']
    assert not headers['Server'].startswith('nginx/')


with tempfile.TemporaryDirectory(prefix='eventmap-headers-') as directory:
    fixture = Path(directory).resolve()
    assert fixture.is_relative_to(Path(tempfile.gettempdir()).resolve())
    (fixture / 'assets').mkdir()
    (fixture / 'index.html').write_text('<!doctype html><title>Local security fixture</title>', encoding='utf8')
    (fixture / 'assets' / 'app.js').write_text('/* Local security fixture */', encoding='utf8')
    # TemporaryDirectory is 0700 on Linux. Only these synthetic public assets
    # need to be readable/traversable by the container's unprivileged worker.
    for public_directory in [fixture, fixture / 'assets']:
        public_directory.chmod(0o755)
    for public_file in [fixture / 'index.html', fixture / 'assets' / 'app.js']:
        public_file.chmod(0o644)
    try:
        docker('run', '-d', '--name', name, '--memory', '64m', '--cpus', '0.5', '--pids-limit', '64',
               '-e', 'NGINX_ENTRYPOINT_WORKER_PROCESSES_AUTOTUNE=1',
               '-p', '127.0.0.1::80',
               '--mount', f'type=bind,source={repo / "client/nginx/nginx-prod.conf"},target=/etc/nginx/conf.d/default.conf,readonly',
               '--mount', f'type=bind,source={repo / "client/nginx/security-headers.conf"},target=/etc/nginx/snippets/security-headers.conf,readonly',
               '--mount', f'type=bind,source={fixture},target=/usr/share/nginx/html,readonly', image)
        docker('exec', name, 'nginx', '-t')
        port = docker('port', name, '80/tcp').rsplit(':', 1)[1]
        base = 'http://127.0.0.1:' + port
        for attempt in range(30):
            try:
                with urllib.request.urlopen(base, timeout=2) as response:
                    check_headers(response)
                break
            except (urllib.error.URLError, ConnectionError):
                if attempt == 29:
                    raise
                time.sleep(0.1)
        token = 'private-query-fixture-' + uuid.uuid4().hex
        for path in ['/events/123', '/index.html', '/assets/app.js', '/missing.js']:
            try:
                response = urllib.request.urlopen(base + path + '?token=' + token, timeout=5)
            except urllib.error.HTTPError as error:
                assert error.code == 404 and path == '/missing.js'
                response = error
            with response:
                check_headers(response)
                if path == '/assets/app.js':
                    assert 'immutable' in response.headers['Cache-Control']
                if path == '/index.html':
                    assert 'no-store' in response.headers['Cache-Control']
        assert token not in docker('logs', name)
        print('Production Nginx headers survive SPA, cache and error responses; access logs omit query tokens.')
    finally:
        subprocess.run(['docker', 'rm', '-f', name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
