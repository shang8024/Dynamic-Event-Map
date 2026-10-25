"""Check production Nginx headers in a disposable, loopback-only container."""
import os
import gzip
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import urllib.robotparser
import uuid
import xml.etree.ElementTree as ET

repo = Path(__file__).resolve().parents[3]
image = os.environ.get('EVENTMAP_NGINX_TEST_IMAGE', 'nginx:alpine')
name = 'eventmap-header-test-' + uuid.uuid4().hex[:12]
backend = name + '-api'
network = name + '-network'


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
    (fixture / 'api').mkdir()
    (fixture / 'index.html').write_text('<!doctype html><title>Local security fixture</title>', encoding='utf8')
    (fixture / 'robots.txt').write_bytes((repo / 'client/public/robots.txt').read_bytes())
    sitemap = ('<?xml version="1.0" encoding="UTF-8"?>\n'
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
               '<url><loc>https://www.dynamic-event-map.cloud/</loc></url>'
               '<url><loc>https://www.dynamic-event-map.cloud/events/123</loc></url></urlset>')
    (fixture / 'api/sitemap.xml').write_text(sitemap, encoding='utf8')
    (fixture / 'backend.conf').write_text('server { listen 5000; root /usr/share/nginx/html; '
        'location = /api/sitemap.xml { types { application/xml xml; } add_header Cache-Control "public, max-age=60"; try_files $uri =404; } '
        'location / { return 404; } }', encoding='utf8')
    asset = '/* Local security fixture */\n' * 200
    (fixture / 'assets' / 'app.js').write_text(asset, encoding='utf8')
    # TemporaryDirectory is 0700 on Linux. Only these synthetic public assets
    # need to be readable/traversable by the container's unprivileged worker.
    for public_directory in [fixture, fixture / 'assets', fixture / 'api']:
        public_directory.chmod(0o755)
    for public_file in [fixture / 'index.html', fixture / 'assets/app.js', fixture / 'robots.txt', fixture / 'api/sitemap.xml', fixture / 'backend.conf']:
        public_file.chmod(0o644)
    try:
        docker('network', 'create', network)
        docker('run', '-d', '--name', backend, '--network', network, '--network-alias', 'tasks.eventmap_api',
               '--memory', '64m', '--cpus', '0.5', '--pids-limit', '64',
               '-e', 'NGINX_ENTRYPOINT_WORKER_PROCESSES_AUTOTUNE=1',
               '--mount', f'type=bind,source={fixture / "backend.conf"},target=/etc/nginx/conf.d/default.conf,readonly',
               '--mount', f'type=bind,source={fixture},target=/usr/share/nginx/html,readonly', image)
        docker('run', '-d', '--name', name, '--memory', '64m', '--cpus', '0.5', '--pids-limit', '64',
               '--network', network,
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
        for path in ['/events/123', '/index.html', '/assets/app.js', '/missing.js', '/robots.txt', '/sitemap.xml']:
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
                if path == '/robots.txt':
                    assert response.headers.get_content_type() == 'text/plain'
                    rules = urllib.robotparser.RobotFileParser()
                    rules.parse(response.read().decode('utf8').splitlines())
                    assert rules.site_maps() == ['https://www.dynamic-event-map.cloud/sitemap.xml']
                    for public_path in ['/', '/events/123', '/api/events/map', '/api/events/123', '/api/events/123/comments/preview', '/api/events/123/image', '/assets/app.js']:
                        assert rules.can_fetch('Googlebot', base + public_path), public_path
                    for private_path in ['/signin', '/settings', '/bookmarks', '/events/new', '/api/auth/me', '/api/notifications', '/socket.io/']:
                        assert not rules.can_fetch('Googlebot', base + private_path), private_path
                if path == '/sitemap.xml':
                    assert response.headers.get_content_type() == 'application/xml'
                    root = ET.fromstring(response.read())
                    urls = [node.text for node in root.findall('{*}url/{*}loc')]
                    assert urls == ['https://www.dynamic-event-map.cloud/', 'https://www.dynamic-event-map.cloud/events/123']
                    assert 'max-age=60' in response.headers['Cache-Control']
        request = urllib.request.Request(base + '/assets/app.js', headers={'Accept-Encoding': 'gzip'})
        with urllib.request.urlopen(request, timeout=5) as response:
            check_headers(response)
            assert response.headers['Content-Encoding'] == 'gzip'
            assert 'Accept-Encoding' in response.headers['Vary']
            compressed = response.read()
            assert gzip.decompress(compressed) == (fixture / 'assets' / 'app.js').read_bytes()
            assert len(compressed) < len(asset) / 2
        assert token not in docker('logs', name)
        # Dependency and file failures must stay failures, never successful SPA HTML.
        docker('stop', backend)
        (fixture / 'robots.txt').unlink()
        for path, codes in [('/robots.txt', [404]), ('/sitemap.xml', [502, 503, 504])]:
            try:
                urllib.request.urlopen(base + path, timeout=15)
                raise AssertionError('Expected a failed crawler response: ' + path)
            except urllib.error.HTTPError as error:
                assert error.code in codes
                check_headers(error)
                assert b'Local security fixture' not in error.read()
        print('Production headers, gzip, root sitemap proxy and robots crawl rules pass; crawler failures never fall back to SPA HTML.')
    finally:
        subprocess.run(['docker', 'rm', '-f', name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        subprocess.run(['docker', 'rm', '-f', backend], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        subprocess.run(['docker', 'network', 'rm', network], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
