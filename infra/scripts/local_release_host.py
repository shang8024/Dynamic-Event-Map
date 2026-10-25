#!/usr/bin/env python3
"""Root-side coordinator sent over pinned SSH by local_release.py.

Uses the existing backup/restore jobs and digest-based deploy.sh. Failed SQL is
never silently retried; an uncertain in-flight migration needs operator review.
"""
import base64
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import time

DEPLOY = Path("/root/deploy")
STATE = Path("/var/lib/eventmap/local-releases")
LEDGERS = Path("/var/lib/eventmap/migrations")
RELEASES = Path("/root/eventmap-releases")
ACCEPTED = Path("/root/eventmap-accepted-releases")
SEQUENCE_LOCK = Path("/var/lib/eventmap/ci-deploy.lock")
MAINTENANCE_LOCK = Path("/var/lock/eventmap-maintenance.lock")


class HostError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise HostError(message)


def private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.stat()
    require(not path.is_symlink() and info.st_uid == 0 and not info.st_mode & 0o077, "Expected a private root-owned release directory.")


def write_private(path, data):
    require(not path.is_symlink(), "Refusing a symlink in release state.")
    temporary = path.with_name(path.name + ".new")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(data); handle.flush(); os.fsync(handle.fileno())
    temporary.replace(path)


@contextlib.contextmanager
def lock(path):
    with path.open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise HostError("Another release or maintenance job is running; retry after it finishes.") from None
        yield


def migration_plan(files, ledger_root):
    migrations = {Path(name).stem: content for name, content in files.items() if name.startswith("db/migrations/")}
    names = sorted(migrations)
    require(names and [int(name[:3]) for name in names] == list(range(1, len(names) + 1)), "Migration numbers must be unique and consecutive from 001.")
    known = {path.stem for path in ledger_root.glob("*.applied")}
    require(known <= set(names), "The host has migrations missing from this release; refusing an older or incomplete schema.")
    pending, gap = [], False
    for name in names:
        ledger = ledger_root / (name + ".applied")
        require(not ledger.is_symlink(), "Refusing a symlink migration ledger.")
        if not ledger.exists():
            gap = True; pending.append(name); continue
        require(not gap and not ledger.is_symlink(), "Applied migrations contain a gap or unsafe ledger.")
        info = ledger.stat()
        hashes = set(re.findall(r"(?m)^([a-f0-9]{64})(?:\s|$)", ledger.read_text()))
        require(info.st_uid == 0 and not info.st_mode & 0o022 and hashes == {hashlib.sha256(migrations[name]).hexdigest()},
                "An applied migration checksum or permission differs. Never rewrite an applied migration.")
    require(len(pending) < len(names), "Initialize and verify a fresh host separately before using this release command.")
    return migrations, pending


class Coordinator:
    def __init__(self, request, validator):
        self.request, self.validator = request, validator
        self.sha, self.prefix = request["sha"], request["prefix"]
        validator.check(validator.SHA, self.sha, "Invalid release SHA.")
        validator.check(validator.PREFIX, self.prefix, "Invalid release prefix.")
        validator.check(validator.DIGEST, request["digest"], "Invalid bundle digest.")
        require(bool(re.fullmatch(r"https://[a-z0-9][a-z0-9.-]*\.[a-z]{2,}", request["url"])), "Invalid public HTTPS origin.")
        private_directory(STATE)
        self.directory = STATE / self.sha; private_directory(self.directory)
        self.evidence = self.directory / "operations.json"
        self.state = json.loads(self.evidence.read_text()) if self.evidence.exists() else {"sha": self.sha, "digest": request["digest"]}
        require(self.state.get("sha") == self.sha and self.state.get("digest") == request["digest"], "This commit already has a different recorded release bundle.")
        self.log = self.directory / "operations.log"

    def save(self):
        write_private(self.evidence, json.dumps(self.state, indent=2).encode())

    def run(self, args, *, data=None, timeout=120):
        try:
            result = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            raise HostError("Host command timed out or could not start; inspect the private operations log.") from None
        with self.log.open("ab") as output:
            self.log.chmod(0o600); output.write(result.stdout + result.stderr)
        require(result.returncode == 0, "Host command failed; inspect " + str(self.log))
        return result.stdout.decode("utf-8").strip()

    def pg(self, sql, database=None):
        arguments = ["docker", "exec", "-i"]
        if database:
            require(database == "postgres" or database == self.state.get("recovery"), "Refusing an unrelated database target.")
            arguments += ["-e", "RELEASE_DB=" + database]
        arguments += [self.container, "sh", "-ec",
                      'export PGPASSWORD="$(cat /run/secrets/pg_password)" PGOPTIONS="-c lock_timeout=5000 -c statement_timeout=120000"; '
                      'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${RELEASE_DB:-$POSTGRES_DB}" -At']
        return self.run(arguments, data=sql if isinstance(sql, bytes) else sql.encode(), timeout=150)

    def job(self, kind, *arguments):
        output = self.run(["bash", str(DEPLOY / "infra/scripts/run_swarm_job.sh"), kind, *arguments], timeout=1500)
        require("JOB_SUCCESS job=" + kind in output, "One-shot job did not confirm success.")
        return output

    def backup(self):
        if self.state.get("backup"):
            require(time.time() - self.state.get("backup_at", 0) < 7200, "This release's backup is stale; inspect the saved state before starting a new attempt.")
            return
        output = self.job("backup")
        match = re.search(r"BACKUP_SUCCESS file=(backup_[A-Za-z0-9_]+\.dump)", output)
        require(match is not None, "Backup did not confirm a verified object.")
        self.state.update(backup=match.group(1), backup_at=time.time()); self.save()
        print("BACKUP_VERIFIED " + match.group(1), flush=True)

    def migrate(self, migrations, pending):
        inflight = self.state.get("migration_in_flight")
        if inflight:
            require(inflight in migrations and (LEDGERS / (inflight + ".applied")).is_file(),
                    "A migration was interrupted. Inspect SQL/ledger before retrying; it will not be replayed automatically.")
            self.state.pop("migration_in_flight"); self.save()
        if not pending:
            print("MIGRATIONS_CURRENT", flush=True); return
        require(not self.state.get("rehearsal_started") or self.state.get("rehearsal_complete"),
                "A recovery rehearsal was interrupted. Inspect its retained database before retrying.")
        if not self.state.get("rehearsal_complete"):
            self.state.update(recovery="recovery_release_" + self.sha[:16] + "_" + secrets.token_hex(4),
                              rehearsal_started=True, pending=pending); self.save()
            output = self.job("restore", self.state["backup"], self.state["recovery"])
            require("RESTORE_SUCCESS target=" + self.state["recovery"] in output, "Recovery job did not confirm the isolated database.")
            require(self.pg("SELECT current_database();", self.state["recovery"]) == self.state["recovery"], "Wrong rehearsal database.")
            with lock(MAINTENANCE_LOCK):
                for name in pending:
                    self.pg(migrations[name], self.state["recovery"])
            self.state["rehearsal_complete"] = True; self.save()
            print("RECOVERY_REHEARSAL_VERIFIED " + self.state["recovery"], flush=True)
        require(set(pending) <= set(self.state["pending"]), "Pending migrations differ from the verified rehearsal.")
        require(time.time() - self.state.get("backup_at", 0) < 7200, "A fresh verified backup is required before production SQL.")
        with lock(MAINTENANCE_LOCK):
            _, current_pending = migration_plan(self.files, LEDGERS)
            require(current_pending == pending, "The schema changed during release preparation.")
            for name in pending:
                self.state["migration_in_flight"] = name; self.save()
                self.pg(migrations[name])
                # Only a successfully completed psql may create a ledger.
                ledger = LEDGERS / (name + ".applied")
                require(not ledger.exists(), "Migration ledger unexpectedly appeared.")
                write_private(ledger, (hashlib.sha256(migrations[name]).hexdigest() + "  " + name + ".sql\n").encode())
                self.state.pop("migration_in_flight"); self.save()
                print("MIGRATION_APPLIED " + name, flush=True)

    def verify(self):
        environment = dict(line.split("=", 1) for line in (DEPLOY / ".release.env").read_text().splitlines() if "=" in line)
        require(environment.get("IMAGE_TAG") == self.sha and environment.get("IMAGE_PREFIX") == self.prefix, "Installed release identity differs.")
        images = dict(line.split("=", 1) for line in self.files["images.lock"].decode().splitlines())
        require((DEPLOY / ".release.images.lock").read_bytes() == self.files["images.lock"], "Installed digest set differs.")
        for service, component in {"api": "api", "client": "client", "image_proxy": "api", "events_ingest": "events-ingest",
                                   "db_backup": "db-backup", "db_restore": "db-backup"}.items():
            actual = self.run(["docker", "service", "inspect", "-f", "{{.Spec.TaskTemplate.ContainerSpec.Image}}", "eventmap_" + service])
            require(actual == self.prefix + "-" + component + "@" + images[component], "A service uses the wrong release image.")
        services = self.run(["docker", "service", "ls", "--format", "{{.Name}}"]).splitlines()
        if "eventmap_notifications" in services:
            actual = self.run(["docker", "service", "inspect", "-f", "{{.Spec.TaskTemplate.ContainerSpec.Image}}", "eventmap_notifications"])
            require(actual == self.prefix + "-api@" + images["api"], "The notification service uses the wrong release image.")
        self.run(["curl", "--fail", "--silent", "--show-error", "--max-time", "20", self.request["url"] + "/api/readyz"])
        print("DEPLOY_VERIFIED " + self.sha, flush=True)

    def cleanup(self):
        recovery = self.state.get("recovery")
        if not recovery or self.state.get("recovery_cleaned"):
            return
        require(self.state.get("rehearsal_complete") and
                re.fullmatch(r"recovery_release_" + self.sha[:16] + r"_[a-f0-9]{8}", recovery), "Refusing to clean an unowned recovery database.")
        with lock(MAINTENANCE_LOCK):
            self.pg('DROP DATABASE IF EXISTS "' + recovery + '";', "postgres")
        self.state["recovery_cleaned"] = True; self.save()
        print("CLEANUP_RECOVERY_REMOVED " + recovery, flush=True)

    def execute(self):
        require(os.geteuid() == 0 and (DEPLOY / ".env").is_file() and (DEPLOY / ".release.env").is_file(), "Use an already configured production host.")
        require(len(self.request["bundle"]) <= 140 * 1024 * 1024, "Oversized release payload.")
        archive = self.directory / "eventmap-release.tar.gz"
        write_private(archive, base64.b64decode(self.request["bundle"], validate=True))
        self.files = self.validator.validate_archive(archive, self.request["digest"], self.sha, self.prefix)
        migrations, pending = migration_plan(self.files, LEDGERS)
        containers = self.run(["docker", "ps", "-q", "--filter", "label=com.docker.swarm.service.name=eventmap_db"]).splitlines()
        require(len(containers) == 1, "Expected one local database task.")
        self.container = containers[0]
        current = (DEPLOY / ".release.env").read_text()
        require(re.search(r"(?m)^IMAGE_PREFIX=" + re.escape(self.prefix) + r"$", current), "Host release prefix does not match the configured repository.")
        if re.search(r"(?m)^IMAGE_TAG=" + self.sha + r"$", current):
            require(not pending, "Current release has missing migration ledgers.")
            self.verify(); self.cleanup(); return
        require(not (ACCEPTED / self.sha).exists(), "This older commit was already accepted. Roll forward with a new commit.")
        self.backup()
        self.migrate(migrations, pending)
        candidate = self.validator.install_bundle(archive, self.request["digest"], self.sha, self.prefix, RELEASES, LEDGERS)
        self.run(["bash", str(candidate / "infra/scripts/deploy.sh"), self.prefix, self.sha, str(candidate)], timeout=900)
        self.verify()
        self.state["accepted_at"] = time.time(); self.save()
        self.cleanup()


def main(request, validator):
    try:
        require(os.geteuid() == 0, "Root access is required.")
        with lock(SEQUENCE_LOCK):
            Coordinator(request, validator).execute()
    except Exception as error:
        # Host command logs stay root-private; never emit SQL, environment or tokens.
        print("HOST_RELEASE_STOPPED " + (str(error) if isinstance(error, HostError) else
              "Inspect the private release operations log; an operation did not complete."), flush=True)
        raise SystemExit(1) from None
