#!/usr/bin/env python3
"""Manual CI deployment using an OIDC role and Lightsail's temporary SSH certificate.

No boto3 dependency, persistent key, ssh-keyscan trust, or public firewall reset.
The cleanup subcommand is also called from the workflow's always() step.
"""
import argparse
import base64
import datetime as dt
import gzip
import hashlib
import io
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request


class DeployError(Exception):
    """Safe operator-facing failure; never include subprocess output or credentials."""


SHA = re.compile(r"[a-f0-9]{40}")
DIGEST = re.compile(r"[a-f0-9]{64}")
PREFIX = re.compile(r"ghcr\.io/[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*")
INSTANCE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,253}")
USER = re.compile(r"[a-z_][a-z0-9_-]{0,31}")
REGION = re.compile(r"[a-z]{2}(?:-[a-z]+)+-[0-9]")
TOKEN = re.compile(r"[1-9][0-9]{0,19}-[1-9][0-9]{0,5}")
KEY_TYPES = {"ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"}
MAX_BUNDLE = 100 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024


def check(pattern, value, message):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise DeployError(message)
    return value


def ipv4(value):
    try:
        address = ipaddress.IPv4Address(value)
    except (ipaddress.AddressValueError, TypeError):
        raise DeployError("Expected a public IPv4 address.") from None
    if not address.is_global:
        raise DeployError("Deployment addresses must be public IPv4 addresses.")
    return str(address)


def digest_file(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_BUNDLE:
        raise DeployError("The release bundle must be a regular file smaller than 100 MiB.")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_archive(bundle, expected_digest, sha, prefix):
    """Return validated regular-file bytes, without extracting or sourcing anything."""
    check(SHA, sha, "Use a full lowercase commit SHA.")
    check(PREFIX, prefix, "Invalid GHCR image prefix.")
    check(DIGEST, expected_digest, "Invalid bundle SHA-256.")
    if digest_file(bundle) != expected_digest:
        raise DeployError("The release bundle checksum does not match.")
    compressed = bundle.read_bytes()
    if hashlib.sha256(compressed).hexdigest() != expected_digest:
        raise DeployError("The release bundle changed during verification.")
    files, seen, expanded = {}, set(), 0
    try:
        # Bound decompression before tarfile parses even extended/PAX headers.
        # The tar framing allowance is separate from the regular-file budget.
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as source:
            unpacked = source.read(MAX_EXPANDED + 8 * 1024 * 1024 + 1)
        if len(unpacked) > MAX_EXPANDED + 8 * 1024 * 1024:
            raise DeployError("The uncompressed tar stream exceeds the release size limit.")
        with tarfile.open(fileobj=io.BytesIO(unpacked), mode="r:") as archive:
            for index, member in enumerate(archive):
                if index >= 2000:
                    raise DeployError("The release bundle contains too many entries.")
                name = member.name.rstrip("/")
                parts = name.split("/")
                if (not name or name.startswith("/") or "\\" in name or
                        any(part in {"", ".", ".."} for part in parts) or
                        not re.fullmatch(r"[A-Za-z0-9._/-]+", name) or name in seen):
                    raise DeployError("The release bundle contains an unsafe or duplicate path.")
                seen.add(name)
                if not (member.isdir() or member.isfile()) or member.issym() or member.islnk():
                    raise DeployError("Links, devices and other special archive entries are forbidden.")
                allowed_dir = (name in {"db", "db/migrations", "infra", "infra/env", "infra/scripts", "infra/system"} or
                               name.startswith(("infra/scripts/", "infra/system/")))
                if member.isdir():
                    if not allowed_dir:
                        raise DeployError("Unexpected directory in the release bundle.")
                    continue
                allowed = name in {"release.env", "images.lock", "stack.yml", "stack.notifications.yml",
                                   "stack.notifications.identity.yml", "db/init.sql", "infra/env/.env.production.example"}
                allowed |= bool(re.fullmatch(r"db/migrations/[0-9]{3}_[a-z0-9_]+\.sql", name))
                allowed |= name.startswith("infra/scripts/") and (name.endswith((".sh", ".py", ".ps1")) or PurePosixPath(name).name == "Dockerfile")
                allowed |= name.startswith("infra/system/") and name.endswith((".service", ".timer"))
                if not allowed or member.size > 8 * 1024 * 1024:
                    raise DeployError("Unexpected or oversized file in the release bundle.")
                expanded += member.size
                if expanded > MAX_EXPANDED:
                    raise DeployError("The expanded release bundle exceeds 64 MiB.")
                handle = archive.extractfile(member)
                if handle is None:
                    raise DeployError("A release file could not be read.")
                files[name] = handle.read()
                if len(files[name]) != member.size:
                    raise DeployError("A release file is truncated.")
    except (tarfile.TarError, OSError, EOFError):
        raise DeployError("The release bundle is not a complete gzip tar archive.") from None
    required = {"release.env", "images.lock", "stack.yml", "stack.notifications.yml",
                "stack.notifications.identity.yml", "db/init.sql", "infra/scripts/deploy.sh"}
    if not required.issubset(files) or not any(name.startswith("db/migrations/") for name in files):
        raise DeployError("The release bundle is incomplete.")
    try:
        records = {}
        for line in files["release.env"].decode("utf-8").splitlines():
            key, sep, value = line.partition("=")
            if not sep or key not in {"IMAGE_PREFIX", "IMAGE_TAG"} or key in records:
                raise DeployError("Invalid release environment record.")
            records[key] = value
        if records != {"IMAGE_PREFIX": prefix, "IMAGE_TAG": sha}:
            raise DeployError("Release metadata does not match the requested commit and image prefix.")
        images = {}
        for line in files["images.lock"].decode("utf-8").splitlines():
            component, sep, value = line.partition("=")
            if (not sep or component not in {"api", "client", "events-ingest", "db-backup"} or
                    component in images or not re.fullmatch(r"sha256:[a-f0-9]{64}", value)):
                raise DeployError("Invalid immutable image manifest.")
            images[component] = value
        if len(images) != 4:
            raise DeployError("Four immutable image digests are required.")
    except UnicodeError:
        raise DeployError("Release metadata must be UTF-8 text.") from None
    return files


def validate_ledgers(files, ledger_root):
    for name, content in files.items():
        if not name.startswith("db/migrations/"):
            continue
        ledger = ledger_root / (PurePosixPath(name).stem + ".applied")
        if ledger.is_symlink() or not ledger.is_file():
            raise DeployError("Apply and record every candidate database migration manually before deploying.")
        info = ledger.stat()
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise DeployError("Migration ledgers must be root-owned and not writable by other users.")
        hashes = set(re.findall(r"(?m)^([a-f0-9]{64})(?:\s|$)", ledger.read_text()))
        if hashes != {hashlib.sha256(content).hexdigest()}:
            raise DeployError("A candidate migration differs from its recorded applied checksum.")


def install_bundle(bundle, expected_digest, sha, prefix, releases_root, ledger_root):
    files = validate_archive(bundle, expected_digest, sha, prefix)
    # Gate before creating a candidate, taking a backup or invoking deployment.
    validate_ledgers(files, ledger_root)
    releases_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if releases_root.is_symlink() or releases_root.stat().st_uid != 0 or releases_root.stat().st_mode & 0o077:
        raise DeployError("The release directory must be a private root-owned directory.")
    candidate = releases_root / sha
    if candidate.exists() or candidate.is_symlink():
        marker = candidate / ".bundle.sha256"
        if (candidate.is_symlink() or not candidate.is_dir() or candidate.stat().st_uid != 0 or candidate.stat().st_mode & 0o077 or
                marker.is_symlink() or not marker.is_file() or marker.read_text().strip() != expected_digest):
            raise DeployError("This commit already exists without the identical bundle checksum; never overwrite a release.")
        existing = {str(path.relative_to(candidate)).replace(os.sep, "/") for path in candidate.rglob("*") if path.is_file()}
        if existing != set(files) | {".bundle.sha256"} or any(path.is_symlink() for path in candidate.rglob("*")):
            raise DeployError("The retained candidate contains unexpected files or links.")
        if any(hashlib.sha256((candidate / name).read_bytes()).digest() != hashlib.sha256(data).digest() for name, data in files.items()):
            raise DeployError("The retained candidate no longer matches its immutable bundle.")
        return candidate
    staging = Path(tempfile.mkdtemp(prefix=f".{sha}.", dir=releases_root))
    try:
        for name, content in files.items():
            target = staging.joinpath(*PurePosixPath(name).parts)
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as handle:
                handle.write(content)
        (staging / ".bundle.sha256").write_text(expected_digest + "\n")
        os.chmod(staging / ".bundle.sha256", 0o600)
        if candidate.exists() or candidate.is_symlink():
            raise DeployError("Another operator staged this commit; inspect it before retrying.")
        staging.rename(candidate)
        return candidate
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def host_key_lines(keys, address):
    if not isinstance(keys, list) or not keys:
        raise DeployError("Lightsail did not provide SSH host keys; refusing unverified SSH.")
    lines = []
    for key in keys:
        algorithm, encoded = key.get("algorithm"), key.get("publicKey")
        if algorithm not in KEY_TYPES or not isinstance(encoded, str) or "\n" in encoded or "\r" in encoded:
            raise DeployError("Lightsail returned an unsupported or malformed host key.")
        parts = encoded.split()
        if len(parts) >= 2 and parts[0] == algorithm:
            encoded = parts[1]
        try:
            raw = base64.b64decode(encoded, validate=True)
            length = struct.unpack(">I", raw[:4])[0]
            if raw[4:4 + length].decode("ascii") != algorithm or len(raw) < 32 or len(raw) > 16384:
                raise ValueError()
        except (ValueError, UnicodeError, struct.error):
            raise DeployError("Lightsail returned an invalid SSH host public key.") from None
        fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")
        if key.get("fingerprintSHA256") != fingerprint:
            raise DeployError("The Lightsail host public key and fingerprint do not match.")
        lines.append(f"{address} {algorithm} {encoded}\n")
    return "".join(lines)


def validate_access(details, instance, expected_ip, username, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if (details.get("protocol") != "ssh" or details.get("instanceName") != instance or
            details.get("username") != username or ipv4(details.get("ipAddress")) != expected_ip):
        raise DeployError("Temporary SSH details do not match the intended instance, IP and username.")
    expiry = details.get("expiresAt")
    try:
        expires = (dt.datetime.fromtimestamp(expiry, dt.timezone.utc) if isinstance(expiry, (int, float))
                   else dt.datetime.fromisoformat(expiry.replace("Z", "+00:00")))
        remaining = (expires - now).total_seconds()
        if not 120 < remaining <= 86400:
            raise ValueError()
    except (ValueError, TypeError, AttributeError, OverflowError):
        raise DeployError("The temporary SSH certificate expiry is absent, too close or invalid.") from None
    private, certificate = details.get("privateKey"), details.get("certKey")
    if (not isinstance(private, str) or len(private) > 65536 or
            not re.fullmatch(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\n[\sA-Za-z0-9+/=]+\n-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*", private)):
        raise DeployError("Lightsail did not return a valid temporary private key.")
    if (not isinstance(certificate, str) or "\n" in certificate.strip() or
            not re.fullmatch(r"(?:ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp(?:256|384|521))-cert-v01@openssh\.com [A-Za-z0-9+/=]+(?: [^\r\n]+)?\s*", certificate)):
        raise DeployError("Lightsail did not return a temporary OpenSSH certificate.")
    return private, certificate.strip() + "\n", host_key_lines(details.get("hostKeys"), expected_ip)


def port_covers(rules, address):
    for rule in rules:
        if rule.get("state") != "open" or rule.get("protocol") not in {"tcp", "all", "-1"}:
            continue
        if rule.get("protocol") == "tcp" and not rule.get("fromPort", 65536) <= 22 <= rule.get("toPort", -1):
            continue
        for cidr in rule.get("cidrs", []):
            try:
                if ipaddress.IPv4Address(address) in ipaddress.IPv4Network(cidr):
                    return True
            except (ipaddress.AddressValueError, ipaddress.NetmaskValueError):
                raise DeployError("Lightsail returned an invalid existing IPv4 firewall rule.") from None
    return False


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise DeployError("The runner IP lookup unexpectedly redirected.")


def runner_address():
    try:
        with urllib.request.build_opener(NoRedirect()).open("https://checkip.amazonaws.com/", timeout=10) as response:
            value = response.read(65)
        if len(value) > 64:
            raise ValueError()
        return ipv4(value.decode("ascii").strip())
    except (OSError, UnicodeError, ValueError):
        raise DeployError("Cannot determine this runner's public IPv4 address safely.") from None


def run_command(arguments, *, text_input=None, timeout=45):
    try:
        result = subprocess.run(arguments, input=text_input, text=True, capture_output=True, timeout=timeout,
                                env={**os.environ, "AWS_PAGER": ""}, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise DeployError(f"The {Path(arguments[0]).name} command could not complete; inspect connectivity and tool availability.") from None
    if result.returncode:
        raise DeployError(f"The {Path(arguments[0]).name} operation failed; no credential output is printed.")
    return result.stdout


class LightsailDeployment:
    def __init__(self, state_path, *, command=run_command, address_lookup=runner_address):
        self.command, self.address_lookup = command, address_lookup
        root = os.environ.get("RUNNER_TEMP")
        if not root or not Path(root).is_absolute():
            raise DeployError("RUNNER_TEMP must name the runner's absolute temporary directory.")
        self.runner_root = Path(root).resolve()
        self.state_path = Path(state_path).absolute()
        if self.state_path.is_symlink() or self.state_path.parent.resolve() != self.runner_root:
            raise DeployError("The protected state file must be directly inside RUNNER_TEMP.")
        self.state = None

    def aws(self, operation, *, timeout=40, **kwargs):
        arguments = ["aws", "--region", self.state["region"], "--no-cli-pager", "--output", "json", "--cli-connect-timeout", "10", "--cli-read-timeout", "25", "lightsail", operation]
        for key, value in kwargs.items():
            arguments += ["--" + key.replace("_", "-"), json.dumps(value, separators=(",", ":")) if isinstance(value, dict) else value]
        try:
            return json.loads(self.command(arguments, timeout=timeout))
        except (json.JSONDecodeError, TypeError):
            raise DeployError("AWS returned an invalid response; deployment is stopped.") from None

    def save_state(self):
        descriptor, name = tempfile.mkstemp(prefix=".eventmap-cd-state-", dir=self.runner_root)
        try:
            os.chmod(name, 0o600)
            with os.fdopen(descriptor, "w") as handle:
                json.dump(self.state, handle)
                handle.flush();os.fsync(handle.fileno())
            os.replace(name, self.state_path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def ssh_options(self):
        work = Path(self.state["work"])
        return ["-F", "/dev/null", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes", "-o", "PermitLocalCommand=no", "-o", "PasswordAuthentication=no",
                "-o", "KbdInteractiveAuthentication=no", "-o", "ConnectTimeout=15", "-o", "ConnectionAttempts=1", "-o", "ServerAliveInterval=15",
                "-o", "ServerAliveCountMax=3", "-o", f"UserKnownHostsFile={work / 'known_hosts'}", "-o", "GlobalKnownHostsFile=/dev/null",
                "-o", f"CertificateFile={work / 'key-cert.pub'}", "-i", str(work / "key")]

    def ssh(self, arguments, text_input=None, timeout=60):
        target = self.state["username"] + "@" + self.state["ip"]
        return self.command(["ssh", *self.ssh_options(), target, shlex.join(arguments)], text_input=text_input, timeout=timeout)

    def prepare(self, *, region, instance, sha, prefix, bundle, username="ubuntu"):
        check(REGION, region, "Invalid AWS region.");check(INSTANCE, instance, "Invalid Lightsail instance name.")
        check(USER, username, "Invalid SSH username.");check(SHA, sha, "Use a full lowercase commit SHA.")
        check(PREFIX, prefix, "Invalid GHCR image prefix.")
        token = f"{os.environ.get('GITHUB_RUN_ID', '')}-{os.environ.get('GITHUB_RUN_ATTEMPT', '')}"
        check(TOKEN, token, "GitHub run ID and attempt are required for isolated cleanup.")
        if self.state_path.exists():
            raise DeployError("A deployment state file already exists. Run cleanup before retrying.")
        bundle = Path(bundle)
        if bundle.is_symlink():
            raise DeployError("The release artifact cannot be a symbolic link.")
        bundle = bundle.resolve()
        if bundle.name != "eventmap-release.tar.gz":
            raise DeployError("Expected the downloaded eventmap-release.tar.gz artifact.")
        bundle_digest = digest_file(bundle)
        validate_archive(bundle, bundle_digest, sha, prefix)
        self.state = {"schema": 1, "region": region, "instance": instance, "token": token, "username": username,
                      "work": str(self.runner_root / ("eventmap-cd-" + token)), "remote": "eventmap-inbound-" + token,
                      "open_intent": False, "preexisting": False, "remote_created": False}
        instance_data = self.aws("get-instance", instance_name=instance).get("instance", {})
        if (instance_data.get("name") != instance or instance_data.get("location", {}).get("regionName") != region or
                instance_data.get("state", {}).get("name") != "running"):
            raise DeployError("The requested Lightsail instance is not running in the configured region.")
        self.state["ip"] = ipv4(instance_data.get("publicIpAddress"))
        details = self.aws("get-instance-access-details", instance_name=instance, protocol="ssh").get("accessDetails", {})
        private, certificate, hosts = validate_access(details, instance, self.state["ip"], username)
        work = Path(self.state["work"])
        work.mkdir(mode=0o700)
        for name, content in {"key": private, "key-cert.pub": certificate, "known_hosts": hosts}.items():
            with os.fdopen(os.open(work / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
                handle.write(content)
        self.save_state()
        self.command(["ssh-keygen", "-y", "-f", str(work / "key")], timeout=10)
        self.command(["ssh-keygen", "-L", "-f", str(work / "key-cert.pub")], timeout=10)
        runner_ip = self.address_lookup()
        self.state["cidr"] = ipv4(runner_ip) + "/32"
        rules = self.aws("get-instance-port-states", instance_name=instance).get("portStates")
        if not isinstance(rules, list):
            raise DeployError("Lightsail did not return the existing firewall rules.")
        self.state["preexisting"] = port_covers(rules, runner_ip)
        self.save_state()
        if not self.state["preexisting"]:
            # Record intent before the API call so even an ambiguous timeout is cleaned up.
            self.state["open_intent"] = True;self.save_state()
            self.aws("open-instance-public-ports", instance_name=instance, port_info=self.port_info())
            self.wait_for_rule(present=True)
        return bundle, bundle_digest

    def port_info(self):
        return {"fromPort": 22, "toPort": 22, "protocol": "tcp", "cidrs": [self.state["cidr"]]}

    def wait_for_rule(self, *, present):
        """An accepted mutation is not proof that Lightsail applied it."""
        deadline = time.monotonic() + 25
        for attempt in range(8):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                rules = self.aws("get-instance-port-states", instance_name=self.state["instance"], timeout=max(1, min(8, remaining))).get("portStates")
                if not isinstance(rules, list):
                    raise DeployError("Missing firewall confirmation data.")
                found = any(rule.get("state") == "open" and rule.get("protocol") == "tcp" and
                            rule.get("fromPort") == 22 and rule.get("toPort") == 22 and
                            self.state["cidr"] in rule.get("cidrs", []) for rule in rules)
                if found == present:
                    return
            except DeployError:
                pass
            if attempt < 7:
                time.sleep(max(0, min(1.5, deadline - time.monotonic())))
        raise DeployError("The temporary SSH rule change could not be confirmed; preserve cleanup state and retry cleanup.")

    def deploy(self, *, sha, prefix, bundle, bundle_digest):
        # An interrupted mkdir can have succeeded remotely; cleanup must still try.
        self.state["remote_created"] = True;self.save_state()
        self.ssh(["sh", "-s", "--", self.state["remote"]], text_input="set -eu\ncase \"$1\" in eventmap-inbound-[0-9]*-[0-9]*) ;; *) exit 1;; esac\n[ ! -e \"$HOME/$1\" ] && [ ! -L \"$HOME/$1\" ]\nmkdir -m 700 -- \"$HOME/$1\"\n")
        sources = [str(bundle), str(Path(__file__).with_name("deploy_bundle.sh")), str(Path(__file__))]
        target = self.state["username"] + "@" + self.state["ip"] + ":" + self.state["remote"] + "/"
        self.command(["scp", "-B", "-q", *self.ssh_options(), "--", *sources, target], timeout=180)
        # GNU timeout owns the remote process group: a lost runner must not leave
        # the orchestration script running indefinitely. SSH has cleanup margin.
        self.ssh(["sudo", "-n", "timeout", "--signal=TERM", "--kill-after=30s", "2300s", "bash",
                  self.state["remote"] + "/deploy_bundle.sh", sha, prefix, bundle_digest], timeout=2450)

    def load_state(self):
        if not self.state_path.exists():
            return False
        info = self.state_path.stat()
        if info.st_mode & 0o077 or info.st_uid != os.getuid():
            raise DeployError("Refusing a deployment state file with unsafe ownership or permissions.")
        try:
            state = json.loads(self.state_path.read_text())
        except (ValueError, OSError):
            raise DeployError("The deployment cleanup state is invalid.") from None
        check(TOKEN, state.get("token"), "Invalid cleanup run identity.")
        if state.get("token") != f"{os.environ.get('GITHUB_RUN_ID', '')}-{os.environ.get('GITHUB_RUN_ATTEMPT', '')}":
            raise DeployError("This cleanup state belongs to a different workflow run.")
        check(REGION, state.get("region"), "Invalid cleanup AWS region.");check(INSTANCE, state.get("instance"), "Invalid cleanup instance.")
        check(USER, state.get("username"), "Invalid cleanup SSH username.")
        if (state.get("schema") != 1 or state.get("remote") != "eventmap-inbound-" + state["token"] or
                state.get("work") != str(self.runner_root / ("eventmap-cd-" + state["token"])) or
                any(not isinstance(state.get(key), bool) for key in ("open_intent", "preexisting", "remote_created"))):
            raise DeployError("Refusing unsafe deployment cleanup paths or flags.")
        if "ip" in state:
            ipv4(state["ip"])
        if "cidr" in state:
            if state["cidr"] != ipv4(state["cidr"].split("/")[0]) + "/32":
                raise DeployError("Cleanup can only remove this runner's exact IPv4 /32 rule.")
        if state["open_intent"] and (state["preexisting"] or "cidr" not in state):
            raise DeployError("Refusing to close a preexisting or unknown firewall rule.")
        self.state = state
        return True

    def cleanup(self):
        if self.state is None and not self.load_state():
            return
        failures = []
        work = Path(self.state["work"])
        try:
            if self.state["remote_created"]:
                removed = False
                try:
                    self.ssh(["sh", "-s", "--", self.state["remote"]], text_input="set -eu\ncase \"$1\" in eventmap-inbound-[0-9]*-[0-9]*) ;; *) exit 1;; esac\ntarget=\"$HOME/$1\"\n[ ! -L \"$target\" ]\nif [ -e \"$target\" ]; then [ -d \"$target\" ] && [ \"$(stat -c %u \"$target\")\" = \"$(id -u)\" ]; rm -rf -- \"$target\"; fi\n", timeout=30)
                    removed = True
                    self.state["remote_created"] = False;self.save_state()
                except Exception:
                    failures.append("The remote cleanup completed but its local state could not be recorded." if removed else
                                    "The run-specific inbound directory needs host-side cleanup.")
        finally:
            # This finally is independent of SSH and all local state-file writes.
            # A full disk or expired certificate must never skip the close API.
            try:
                if self.state["open_intent"] and not self.state["preexisting"]:
                    closed = False
                    try:
                        self.aws("close-instance-public-ports", instance_name=self.state["instance"], port_info=self.port_info())
                        self.wait_for_rule(present=False)
                        closed = True
                        self.state["open_intent"] = False;self.save_state()
                    except Exception:
                        failures.append("The temporary SSH rule was closed but its local state could not be recorded; retry cleanup." if closed else
                                        "The temporary SSH /32 firewall rule could not be closed; retry the cleanup step.")
            finally:
                if work.exists() or work.is_symlink():
                    if work.is_symlink() or work.parent.resolve() != self.runner_root or work.name != "eventmap-cd-" + self.state["token"]:
                        failures.append("Refusing an unsafe temporary-key cleanup path.")
                    else:
                        try:
                            shutil.rmtree(work)
                        except OSError:
                            failures.append("The run-specific temporary key directory could not be removed.")
        if failures:
            raise DeployError(" ".join(failures))
        self.state_path.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    deploy = commands.add_parser("deploy")
    for name in ("region", "instance", "sha", "prefix", "bundle", "state"):
        deploy.add_argument("--" + name, required=True)
    deploy.add_argument("--user", default="ubuntu")
    cleanup = commands.add_parser("cleanup");cleanup.add_argument("--state", required=True)
    install = commands.add_parser("install-bundle")
    for name in ("bundle", "digest", "sha", "prefix"):
        install.add_argument("--" + name, required=True)
    args = parser.parse_args(argv)
    if args.command == "install-bundle":
        if not hasattr(os, "geteuid") or os.geteuid() != 0:
            raise DeployError("Only root may stage a production release.")
        install_bundle(Path(args.bundle), args.digest, args.sha, args.prefix, Path("/root/eventmap-releases"), Path("/var/lib/eventmap/migrations"))
        print("Bundle verified and staged; all migration checksums already match.")
        return
    if args.command == "cleanup" and not Path(args.state).exists() and not Path(args.state).is_symlink():
        print("No temporary deployment access was recorded.")
        return
    if not (os.environ.get("AWS_ACCESS_KEY_ID", "").startswith("ASIA") and os.environ.get("AWS_SECRET_ACCESS_KEY") and os.environ.get("AWS_SESSION_TOKEN")):
        raise DeployError("Configure the short-lived AWS role session before deployment or cleanup.")
    if any(os.environ.get(name) for name in ("AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_LIGHTSAIL")):
        raise DeployError("Custom AWS endpoints are not permitted for deployment trust decisions.")
    session = LightsailDeployment(args.state)
    if args.command == "cleanup":
        session.cleanup();print("Temporary deployment access cleaned up.")
        return
    try:
        bundle, digest = session.prepare(region=args.region, instance=args.instance, sha=args.sha, prefix=args.prefix, bundle=args.bundle, username=args.user)
        session.deploy(sha=args.sha, prefix=args.prefix, bundle=bundle, bundle_digest=digest)
        print("The requested release passed host backup and deployment checks.")
    finally:
        if session.state is not None:
            session.cleanup()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        main()
    except DeployError as failure:
        print(f"Deployment stopped: {failure}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("Deployment interrupted; the workflow cleanup step must complete.", file=sys.stderr)
        sys.exit(130)
