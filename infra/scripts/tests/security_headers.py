"""Check production Nginx headers in a disposable, loopback-only container."""
import os
import gzip
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import urllib.robotparser
import uuid
import xml.etree.ElementTree as ET

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
    url = urlsplit(response.geturl())
    expected = 'index, follow' if url.path in ['', '/'] and not url.query else 'noindex, follow'
    assert headers['X-Robots-Tag'] == expected, response.geturl()


with tempfile.TemporaryDirectory(prefix='eventmap-headers-') as directory:
    fixture = Path(directory).resolve()
    assert fixture.is_relative_to(Path(tempfile.gettempdir()).resolve())
    (fixture / 'assets').mkdir()
    (fixture / 'index.html').write_text('<!doctype html><title>Local security fixture</title>', encoding='utf8')
    (fixture / 'robots.txt').write_bytes((repo / 'client/public/robots.txt').read_bytes())
    (fixture / 'sitemap.xml').write_bytes((repo / 'client/public/sitemap.xml').read_bytes())
    asset = '/* Local security fixture */\n' * 200
    (fixture / 'assets' / 'app.js').write_text(asset, encoding='utf8')
    # TemporaryDirectory is 0700 on Linux. Only these synthetic public assets
    # need to be readable/traversable by the container's unprivileged worker.
    for public_directory in [fixture, fixture / 'assets']:
        public_directory.chmod(0o755)
    for public_file in [fixture / 'index.html', fixture / 'assets/app.js', fixture / 'robots.txt', fixture / 'sitemap.xml']:
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
        for path in ['/events/123', '/events/%31', '/%65vents/123', '/?event=123', '/?ev%65nt=123', '/settings', '/index.html', '/assets/app.js', '/missing.js', '/robots.txt', '/sitemap.xml']:
            try:
                response = urllib.request.urlopen(base + path + ('&' if '?' in path else '?') + 'token=' + token, timeout=5)
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
                    for public_path in ['/', '/events/123', '/api/events/map', '/api/events/123', '/api/events/123/comments/preview', '/api/events/123/image', '/assets/app.js', '/settings', '/signin', '/events/new']:
                        assert rules.can_fetch('Googlebot', base + public_path), public_path
                    assert not rules.can_fetch('Googlebot', base + '/socket.io/')
                if path == '/sitemap.xml':
                    assert response.headers.get_content_type() == 'application/xml'
                    root = ET.fromstring(response.read())
                    urls = [node.text for node in root.findall('{*}url/{*}loc')]
                    assert urls == ['https://www.dynamic-event-map.cloud/']
                    assert 'max-age=3600' in response.headers['Cache-Control']
        request = urllib.request.Request(base + '/assets/app.js', headers={'Accept-Encoding': 'gzip'})
        with urllib.request.urlopen(request, timeout=5) as response:
            check_headers(response)
            assert response.headers['Content-Encoding'] == 'gzip'
            assert 'Accept-Encoding' in response.headers['Vary']
            compressed = response.read()
            assert gzip.decompress(compressed) == (fixture / 'assets' / 'app.js').read_bytes()
            assert len(compressed) < len(asset) / 2
        assert token not in docker('logs', name)
        # Missing crawler files must stay 404s, never successful SPA HTML.
        (fixture / 'robots.txt').unlink()
        (fixture / 'sitemap.xml').unlink()
        for path, codes in [('/robots.txt', [404]), ('/sitemap.xml', [404])]:
            try:
                urllib.request.urlopen(base + path, timeout=15)
                raise AssertionError('Expected a failed crawler response: ' + path)
            except urllib.error.HTTPError as error:
                assert error.code in codes
                check_headers(error)
                assert b'Local security fixture' not in error.read()
        print('Production headers, gzip and homepage-only sitemap pass; dynamic event URLs and query views stay noindex; missing crawler files stay 404.')
    finally:
        subprocess.run(['docker', 'rm', '-f', name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
