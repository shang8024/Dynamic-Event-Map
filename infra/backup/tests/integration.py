"""Disposable Docker integration test; uses dummy credentials and a LOCAL S3 fixture.

Run: python infra/backup/tests/integration.py
Build first: docker build -t eventmap-backup-check:local infra/backup
No cloud account, published ports, or existing database is used.
"""
import re
import subprocess
import time
import uuid

IMAGE = "eventmap-backup-check:local"
suffix = uuid.uuid4().hex[:10]
network = f"eventmap-backup-test-{suffix}"
database = f"{network}-db"
storage = f"{network}-s3"
containers = []
storage_endpoint = ""


def docker(*args, check=True):
    result = subprocess.run(["docker", *args], text=True, capture_output=True, timeout=120)
    if check and result.returncode:
        raise AssertionError(f"Docker operation failed: {args[:3]}\n{result.stdout}{result.stderr}")
    return result


def psql(sql, db="eventsdb"):
    return docker("exec", database, "psql", "-U", "app", "-d", db, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql).stdout.strip()


def run(entry="backup.sh", **overrides):
    config = dict(DB_HOST="db", DB_USER="app", DB_NAME="eventsdb", DB_PASSWORD_FILE="/tmp/pg",
                  S3_PROVIDER="AWS", S3_REGION="ca-central-1", S3_BUCKET="eventmap-test",
                  S3_ENDPOINT=storage_endpoint, S3_ALLOW_HTTP="true",
                  S3_ACCESS_KEY_FILE="/tmp/access", S3_SECRET_KEY_FILE="/tmp/secret",
                  RCLONE_RETRIES="1", RCLONE_LOW_LEVEL_RETRIES="1", RCLONE_CONNECT_TIMEOUT="2s",
                  RCLONE_S3_USE_UNSIGNED_PAYLOAD="true")  # Local HTTP fixture lacks AWS trailer signing.
    config.update(overrides)
    env = [item for key, value in config.items() for item in ("-e", f"{key}={value}")]
    setup = "printf test-only-password > /tmp/pg; printf fixture-access > /tmp/access; printf fixture-secret > /tmp/secret; exec /usr/local/bin/" + entry
    return docker("run", "--rm", "--network", network, *env, "--entrypoint", "bash", IMAGE, "-ec", setup, check=False)


def succeeds(result, marker):
    assert result.returncode == 0, result.stdout + result.stderr
    assert marker in result.stdout, result.stdout


def rejects(result, reason):
    assert result.returncode != 0, result.stdout
    assert reason in result.stdout + result.stderr, result.stdout + result.stderr
    assert "BACKUP_SUCCESS" not in result.stdout and "RESTORE_SUCCESS" not in result.stdout


try:
    docker("network", "create", network)
    docker("run", "-d", "--name", database, "--network", network, "--network-alias", "db",
           "-e", "POSTGRES_PASSWORD=test-only-password", "-e", "POSTGRES_USER=app",
           "-e", "POSTGRES_DB=eventsdb", "postgres:16-alpine")
    containers.append(database)
    docker("run", "-d", "--name", storage, "--network", network, "--network-alias", "storage",
           "--entrypoint", "sh", IMAGE, "-ec",
           "mkdir -p /data/eventmap-test; exec rclone serve s3 /data --addr :9000 --auth-key fixture-access,fixture-secret")
    containers.append(storage)
    storage_ip = docker("inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", storage).stdout.strip()
    storage_endpoint = f"http://{storage_ip}:9000"
    for attempt in range(30):
        if docker("exec", database, "pg_isready", "-U", "app", check=False).returncode == 0:
            break
        time.sleep(1)
    psql("CREATE TABLE proof(id integer PRIMARY KEY, value text); INSERT INTO proof VALUES (1,'preserve me');")

    rejects(run(S3_BUCKET=""), "Set a valid S3_BUCKET")
    rejects(run(DB_PASSWORD_FILE="/tmp/missing"), "unreadable")
    rejects(run(S3_ALLOW_HTTP="false"), "S3 requires HTTPS")
    rejects(run(S3_ENDPOINT="http://storage:1"), "ERROR")
    backup = run()
    succeeds(backup, "BACKUP_SUCCESS")
    filename = re.search(r"file=(\S+)", backup.stdout).group(1)
    succeeds(run(S3_PROVIDER="DigitalOcean", S3_REGION="tor1"), "BACKUP_SUCCESS")
    listing = run("list.sh")
    succeeds(listing, filename + ".sha256")

    for target in ("recovery_good", "recovery_corrupt", "recovery_missing"):
        docker("exec", database, "createdb", "-U", "app", target)
    args = dict(BACKUP_FILE=filename, RESTORE_DB_NAME="recovery_good", RESTORE_CONFIRM_TARGET="recovery_good")
    succeeds(run("restore.sh", **args), "RESTORE_SUCCESS")
    assert psql("SELECT id || ':' || value FROM proof", "recovery_good") == "1:preserve me"
    assert psql("SELECT count(*) FROM proof") == "1"
    rejects(run("restore.sh", **args), "not empty")
    rejects(run("restore.sh", **(args | {"RESTORE_CONFIRM_TARGET": ""})), "confirmation")
    rejects(run("restore.sh", **(args | {"RESTORE_DB_NAME": "eventsdb"})), "must begin recovery_")
    rejects(run("restore.sh", **(args | {"BACKUP_FILE": "../../escape.dump"})), "basename")
    rejects(run("restore.sh", BACKUP_FILE="backup_missing_20261021.dump", RESTORE_DB_NAME="recovery_missing",
                RESTORE_CONFIRM_TARGET="recovery_missing"), "ERROR")

    docker("exec", storage, "sh", "-ec", f"printf corrupt >> /data/eventmap-test/backups/{filename}")
    rejects(run("restore.sh", BACKUP_FILE=filename, RESTORE_DB_NAME="recovery_corrupt",
                RESTORE_CONFIRM_TARGET="recovery_corrupt"), "checksum mismatch")
    assert psql("SELECT count(*) FROM pg_tables WHERE schemaname='public'", "recovery_corrupt") == "0"
    print("PASS: PostgreSQL dump -> local S3 upload/read-back -> empty-db restore; AWS/DO configuration, missing credentials/upload, target safety and corruption failures.")
finally:
    for name in reversed(containers):
        docker("rm", "-f", "-v", name, check=False)
    docker("network", "rm", network, check=False)
