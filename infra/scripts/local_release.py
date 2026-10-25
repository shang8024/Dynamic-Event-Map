#!/usr/bin/env python3
"""Owner-operated Windows/Linux releases. No credentials or cloud provisioning.

The default command publishes and deploys. --check is local/read-only: no SSH,
registry writes, builds, backups, migrations or rollout.
"""
import argparse
import base64
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
COMPONENTS = {"api": "api", "client": "client", "events-ingest": "infra/ingest", "db-backup": "infra/backup"}
FRONTEND_KEYS = (
    "VITE_GOOGLE_MAPS_KEY", "VITE_GOOGLE_MAPS_MAP_ID", "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_APP_ID", "VITE_FIREBASE_MESSAGING_SENDER_ID",
)


class ReleaseError(Exception):
    """Operator-safe message, without raw subprocess output."""


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def run(args, *, env=None, data=None, timeout=120, log=None, sensitive=()):
    """Use bytes for stdin, especially SSH: Windows text mode corrupts Bash LF."""
    try:
        result = subprocess.run(args, cwd=ROOT, env=env, input=data, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise ReleaseError(f"{Path(args[0]).name} failed to start or timed out.") from None
    if log:
        output = result.stdout + result.stderr
        for value in sensitive:
            if value:
                output = output.replace(value.encode(), b"[REDACTED]")
        log.write_bytes(output)
        log.chmod(0o600)
    require(result.returncode == 0, f"{Path(args[0]).name} failed. " +
            (f"Inspect the private log: {log}" if log else "Check login, permissions and connectivity; command output was withheld."))
    return result.stdout


def command(args, **options):
    return run(args, **options).decode("utf-8").strip()


def external_path(value):
    require(isinstance(value, str) and value and "\n" not in value and "\r" not in value,
            "Configuration paths must be nonempty strings.")
    path = Path(os.path.expandvars(value)).expanduser().resolve()
    require(not path.is_relative_to(ROOT), "Deployment settings, keys and artifacts must live outside the checkout.")
    return path


def configuration(path):
    path = external_path(str(path))
    require(path.is_file(), "Create the private deploy.json using infra/env/deploy.example.json first.")
    config = json.loads(path.read_text(encoding="utf-8-sig"))
    fields = {"repository", "host", "user", "identity_file", "known_hosts_file", "frontend_env", "state_dir", "url"}
    require(isinstance(config, dict) and set(config) == fields, "deploy.json has missing or unexpected fields.")
    require(all(isinstance(value, str) for value in config.values()), "deploy.json values must be strings.")
    require(bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*", config["repository"])), "Invalid repository.")
    require(bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}", config["host"])), "Invalid SSH host.")
    require(bool(re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", config["user"])), "Invalid SSH user.")
    require(bool(re.fullmatch(r"https://[a-z0-9][a-z0-9.-]*\.[a-z]{2,}", config["url"])), "Use an HTTPS origin without a path.")
    for name in ("identity_file", "known_hosts_file", "frontend_env", "state_dir"):
        config[name] = external_path(config[name])
        if name != "state_dir":
            require(config[name].is_file(), f"The configured {name} file is missing.")
    config["prefix"] = "ghcr.io/" + config["repository"].lower() + "-production"
    return config


def frontend_settings(path):
    values = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, sep, value = line.partition("=")
        require(sep and name in FRONTEND_KEYS and name not in values,
                "frontend.env accepts only the documented VITE browser settings, once each.")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        require(bool(re.fullmatch(r"[A-Za-z0-9._:/-]{1,512}", value)), f"Invalid browser setting: {name}.")
        values[name] = value
    require(set(values) == set(FRONTEND_KEYS), "frontend.env is incomplete; see the production browser example.")
    require(bool(re.fullmatch(r"[a-fA-F0-9]{16,32}", values["VITE_GOOGLE_MAPS_MAP_ID"])), "Configure a production vector Map ID.")
    return {**values, "VITE_API_BASE_URL": "/api"}


def repository_state(config):
    require(not command(["git", "status", "--porcelain=v1"]), "Commit or remove checkout changes before releasing.")
    require(command(["git", "branch", "--show-current"]) == "main", "Deploy from the reviewed main branch.")
    remote = command(["git", "remote", "get-url", "origin"])
    repo = re.escape(config["repository"])
    require(bool(re.fullmatch(rf"(?:https://github\.com/|git@github\.com:){repo}(?:\.git)?", remote, re.I)), "origin does not match deploy.json.")
    sha = command(["git", "rev-parse", "HEAD"])
    require(bool(re.fullmatch(r"[a-f0-9]{40}", sha)), "Invalid commit SHA.")
    head = command(["gh", "api", f"repos/{config['repository']}/commits/main", "--jq", ".sha"])
    require(head == sha, "Push main first. Local HEAD must equal GitHub main.")
    return sha


def wait_for_ci(config, sha, *, wait=True):
    deadline = time.monotonic() + (1500 if wait else 0)
    while True:
        runs = json.loads(command(["gh", "run", "list", "--repo", config["repository"], "--workflow", "ci.yml",
                                   "--branch", "main", "--commit", sha, "--event", "push", "--limit", "1",
                                   "--json", "headSha,status,conclusion,url"]))
        if runs and runs[0]["status"] == "completed":
            require(runs[0]["headSha"] == sha and runs[0]["conclusion"] == "success", "This commit's CI did not pass. Fix CI before deployment.")
            print("CI passed: " + runs[0]["url"], flush=True)
            return
        require(wait and time.monotonic() < deadline, "CI has not passed for this commit yet.")
        print("Waiting for this commit's CI...", flush=True)
        time.sleep(15)


def git_files(sha):
    """Read exact Git blob bytes; git archive/working files can apply Windows CRLF."""
    entries = []
    for record in run(["git", "ls-tree", "-rz", "--full-tree", sha]).split(b"\0"):
        if not record:
            continue
        metadata, raw_name = record.split(b"\t", 1)
        mode, kind, oid = metadata.decode().split()
        name = raw_name.decode("utf-8")
        require(kind == "blob" and mode in {"100644", "100755"}, "Release sources may not contain symlinks or submodules.")
        require(not name.startswith("/") and "\\" not in name and not any(x in {"", ".", ".."} for x in name.split("/")), "Unsafe committed path.")
        require(not name.startswith(("docs/", ".local/")), "Private operational files must not be committed.")
        entries.append((name, oid))
    response = run(["git", "cat-file", "--batch"], data="".join(oid + "\n" for _, oid in entries).encode())
    stream, files, total = io.BytesIO(response), {}, 0
    for name, oid in entries:
        header = stream.readline().decode().strip().split()
        require(len(header) == 3 and header[:2] == [oid, "blob"], "Cannot export committed sources.")
        size = int(header[2]); total += size
        require(size <= 32 * 1024 * 1024 and total <= 256 * 1024 * 1024, "Committed build sources exceed the release limit.")
        files[name] = stream.read(size)
        require(len(files[name]) == size and stream.read(1) == b"\n", "Truncated Git source export.")
    return files


def bundle_files(files):
    selected = {}
    for name, data in files.items():
        if (name in {"stack.yml", "stack.notifications.yml", "stack.notifications.identity.yml", "db/init.sql", "infra/env/.env.production.example"}
            or re.fullmatch(r"db/migrations/[0-9]{3}_[a-z0-9_]+\.sql", name)
            or name.startswith("infra/scripts/") and (name.endswith((".py", ".sh", ".ps1")) or PurePosixPath(name).name == "Dockerfile")
            or name.startswith("infra/system/") and name.endswith((".service", ".timer"))):
            selected[name] = data
    return selected


def make_bundle(path, files, sha, prefix, images):
    payloads = {**bundle_files(files), "release.env": f"IMAGE_PREFIX={prefix}\nIMAGE_TAG={sha}\n".encode(),
                "images.lock": "".join(f"{key}={images[key]}\n" for key in COMPONENTS).encode()}
    with path.open("wb") as output, gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for name, content in sorted(payloads.items()):
                info = tarfile.TarInfo(name); info.size = len(content); info.mode = 0o600
                archive.addfile(info, io.BytesIO(content))
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    spec = importlib.util.spec_from_file_location("eventmap_bundle_validator", ROOT / "infra/scripts/ci_deploy_lightsail.py")
    validator = importlib.util.module_from_spec(spec); spec.loader.exec_module(validator)
    require(validator.validate_archive(path, digest, sha, prefix) == payloads, "Release bundle verification failed.")
    return digest


class RegistryRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, url):
        require(urllib.parse.urlsplit(url).scheme == "https", "Registry redirects must use HTTPS.")
        redirected = super().redirect_request(request, fp, code, msg, headers, url)
        if redirected and urllib.parse.urlsplit(request.full_url).netloc != urllib.parse.urlsplit(url).netloc:
            redirected.remove_header("Authorization")
        return redirected


class Registry:
    """GHCR only; credentials never appear in subprocess arguments or logs."""
    def __init__(self, username, token):
        self.username, self.token = username, token
        self.opener = urllib.request.build_opener(RegistryRedirect())

    def image(self, repository, sha):
        query = urllib.parse.urlencode({"service": "ghcr.io", "scope": f"repository:{repository}:pull"})
        auth = base64.b64encode(f"{self.username}:{self.token}".encode()).decode()
        request = urllib.request.Request("https://ghcr.io/token?" + query, headers={"Authorization": "Basic " + auth})
        with self.opener.open(request, timeout=30) as response:
            bearer = json.load(response)["token"]
        headers = {"Authorization": "Bearer " + bearer, "Accept": "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json"}
        request = urllib.request.Request(f"https://ghcr.io/v2/{repository}/manifests/{sha}", headers=headers)
        try:
            with self.opener.open(request, timeout=30) as response:
                raw, digest = response.read(), response.headers.get("Docker-Content-Digest", "")
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            raise
        require(digest == "sha256:" + hashlib.sha256(raw).hexdigest(), "Registry manifest checksum mismatch.")
        manifest = json.loads(raw)
        config_digest = manifest.get("config", {}).get("digest", "")
        require(bool(re.fullmatch(r"sha256:[a-f0-9]{64}", config_digest)), "Expected a single-platform release image.")
        request = urllib.request.Request(f"https://ghcr.io/v2/{repository}/blobs/{config_digest}", headers=headers)
        with self.opener.open(request, timeout=30) as response:
            raw = response.read()
        require("sha256:" + hashlib.sha256(raw).hexdigest() == config_digest, "Registry config checksum mismatch.")
        return digest, json.loads(raw)


def validate_image(image, config, sha):
    labels = image.get("config", {}).get("Labels", {})
    require(image.get("os") == "linux" and image.get("architecture") == "amd64" and
            labels.get("org.opencontainers.image.revision") == sha and
            labels.get("io.dynamic-event-map.image-prefix") == config["prefix"] and
            labels.get("org.opencontainers.image.source") == "https://github.com/" + config["repository"],
            "Existing registry tag does not match this repository, commit and platform. Refusing to overwrite it.")


def publish(config, sha, files, settings, directory):
    token = command(["gh", "auth", "token", "--hostname", "github.com"])
    username = command(["gh", "api", "user", "--jq", ".login"])
    registry = Registry(username, token)
    # Temporary auth must keep the selected local engine without importing old credentials.
    context = json.loads(command(["docker", "context", "inspect"]))[0]
    endpoint = os.environ.get("DOCKER_HOST") or context["Endpoints"]["docker"]["Host"]
    require(endpoint.startswith(("npipe://", "unix://")), "Use a local Linux Docker engine for releases.")
    images = {}
    with tempfile.TemporaryDirectory(prefix="registry-", dir=directory) as temporary:
        auth = base64.b64encode(f"{username}:{token}".encode()).decode()
        auth_file = Path(temporary) / "config.json"
        auth_file.write_text(json.dumps({"auths": {"ghcr.io": {"auth": auth}}})); auth_file.chmod(0o600)
        push_env = {**os.environ, "DOCKER_CONFIG": temporary, "DOCKER_HOST": endpoint}
        push_env.pop("DOCKER_CONTEXT", None)
        with tempfile.TemporaryDirectory(prefix="source-", dir=directory) as source:
            for name, data in files.items():
                if any(name.startswith(context + "/") for context in COMPONENTS.values()):
                    target = Path(source) / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
            for component, build_context in COMPONENTS.items():
                repository = config["prefix"].removeprefix("ghcr.io/") + "-" + component
                ref = "ghcr.io/" + repository + ":" + sha
                existing = registry.image(repository, sha)
                if existing:
                    digest, image = existing; validate_image(image, config, sha)
                    print(f"Reusing published image: {component}", flush=True)
                else:
                    print(f"Building and publishing: {component}", flush=True)
                    args = ["docker", "buildx", "build", "--platform", "linux/amd64", "--load", "--provenance=false",
                            "--label", "org.opencontainers.image.source=https://github.com/" + config["repository"],
                            "--label", "org.opencontainers.image.revision=" + sha,
                            "--label", "io.dynamic-event-map.image-prefix=" + config["prefix"], "--tag", ref]
                    if component == "client":
                        for name in settings:
                            args.extend(["--build-arg", name])
                    args.append(str(Path(source) / build_context))
                    sensitive = (token, auth, *settings.values())
                    run(args, env={**os.environ, **settings}, timeout=1800, log=directory / f"build-{component}.log", sensitive=sensitive)
                    # A concurrent publisher must never have its commit tag overwritten.
                    require(registry.image(repository, sha) is None, "Release tag appeared during build; rerun to verify and reuse it.")
                    run(["docker", "push", ref], env=push_env, timeout=1200, log=directory / f"push-{component}.log", sensitive=sensitive)
                    result = registry.image(repository, sha)
                    require(result is not None, "Published image is missing from GHCR.")
                    digest, image = result; validate_image(image, config, sha)
                images[component] = digest
    manifest = directory / "images.json"
    if manifest.exists():
        require(json.loads(manifest.read_text()) == images, "This release already has a different immutable digest set.")
    manifest.write_text(json.dumps(images, indent=2)); manifest.chmod(0o600)
    return images


def ssh_arguments(config):
    return ["ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=4", "-o", "StrictHostKeyChecking=yes", "-o", "IdentitiesOnly=yes",
            "-o", "UserKnownHostsFile=" + str(config["known_hosts_file"]), "-i", str(config["identity_file"]),
            config["user"] + "@" + config["host"], "sudo -n python3 -"]


def remote_deploy(config, sha, files, bundle, digest, directory):
    payload = {"sha": sha, "prefix": config["prefix"], "digest": digest, "url": config["url"],
               "bundle": base64.b64encode(bundle.read_bytes()).decode()}
    validator = files["infra/scripts/ci_deploy_lightsail.py"]
    host = files["infra/scripts/local_release_host.py"]
    # Ship only committed coordinator code, not local files. No shell interpolation.
    program = ("import types\nvalidator=types.ModuleType('validator')\nexec(" + repr(validator) + ",validator.__dict__)\n" +
               "exec(" + repr(host) + ")\nmain(" + repr(payload) + ",validator)\n").encode()
    print("Running protected host backup, migration checks and rollout...", flush=True)
    # A single remote process owns the release lock. Capture raw output privately.
    output = run(ssh_arguments(config), data=program, timeout=5400, log=directory / "host.log")
    for line in output.decode("utf-8").splitlines():
        if re.fullmatch(r"(?:HOST|BACKUP|RECOVERY|MIGRATION|DEPLOY|CLEANUP)_[A-Z_]+(?: [A-Za-z0-9_./:=-]+)*", line):
            print(line, flush=True)
    require(f"DEPLOY_VERIFIED {sha}" in output.decode(), "Host did not confirm the deployed commit.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args()
    require(sys.version_info >= (3, 11), "Python 3.11+ is required.")
    for name in ("git", "gh", "docker", "ssh"):
        require(shutil.which(name), f"Install {name} and add it to PATH.")
    config = configuration(options.config)
    settings = frontend_settings(config["frontend_env"])
    sha = repository_state(config)
    require(command(["docker", "info", "--format", "{{.OSType}}"]) == "linux", "Start Docker Desktop using Linux containers.")
    command(["docker", "buildx", "version"])
    wait_for_ci(config, sha, wait=not options.check)
    if options.check:
        print("CHECK_OK: clean main, GitHub commit/CI, local Docker, settings and key paths. No server was contacted.")
        return
    # Fail before building or publishing if SSH, sudo or host identity is wrong.
    probe = b"import os,pathlib,subprocess\nassert os.geteuid()==0\nassert pathlib.Path('/root/deploy/.release.env').is_file()\nassert pathlib.Path('/root/deploy/infra/scripts/run_swarm_job.sh').is_file()\nassert subprocess.check_output(['docker','info','--format','{{.Swarm.LocalNodeState}}']).strip()==b'active'\nprint('HOST_READY')\n"
    require(command(ssh_arguments(config), data=probe) == "HOST_READY", "The server is not bootstrapped for this application.")
    files = git_files(sha)
    directory = config["state_dir"] / sha
    directory.mkdir(parents=True, exist_ok=True); directory.chmod(0o700)
    images = publish(config, sha, files, settings, directory)
    bundle = directory / "eventmap-release.tar.gz"
    digest = make_bundle(bundle, files, sha, config["prefix"], images)
    # Recheck after a long build: never release a commit displaced from main.
    require(repository_state(config) == sha, "The checkout changed during publishing.")
    remote_deploy(config, sha, files, bundle, digest, directory)
    with urllib.request.urlopen(config["url"] + "/api/readyz", timeout=20) as response:
        require(response.status == 200, "Public HTTPS readiness check failed.")
    (directory / "success.json").write_text(json.dumps({"sha": sha, "bundle_sha256": digest, "url": config["url"]}, indent=2))
    print("Deployment complete: " + config["url"] + " (" + sha[:7] + ")", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (ReleaseError, OSError, ValueError, KeyError, urllib.error.URLError) as error:
        # Network libraries can embed URLs/headers in exceptions; do not echo them.
        print("Deployment stopped: " + (str(error) if isinstance(error, ReleaseError) else
              "Configuration, registry, network or filesystem operation failed; no raw credential output was printed."), file=sys.stderr)
        sys.exit(1)
