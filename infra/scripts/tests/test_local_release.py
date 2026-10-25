"""Offline local-release safety tests; no cloud, SSH or registry access."""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.request

SCRIPTS = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


local = load("local_release", SCRIPTS / "local_release.py")
host = load("local_release_host", SCRIPTS / "local_release_host.py")
validator = load("release_validator", SCRIPTS / "ci_deploy_lightsail.py")
SHA, PREFIX = "a" * 40, "ghcr.io/test/eventmap-production"


def sources():
    return {"stack.yml": b"services: {}\n", "stack.notifications.yml": b"services: {}\n",
            "stack.notifications.identity.yml": b"services: {}\n", "db/init.sql": b"SELECT 1;\n",
            "db/migrations/001_initial.sql": b"SELECT 1;\n", "db/migrations/002_new.sql": b"SELECT 2;\n",
            "infra/scripts/deploy.sh": b"#!/bin/bash\nexit 0\n"}


class LocalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_frontend_rejects_secrets_shell_expressions_duplicates_and_missing(self):
        path = self.root / "frontend.env"
        valid = {key: "test-value" for key in local.FRONTEND_KEYS}
        valid["VITE_GOOGLE_MAPS_MAP_ID"] = "a" * 16
        baseline = "".join(f"{key}={value}\n" for key, value in valid.items())
        path.write_text(baseline)
        self.assertEqual(local.frontend_settings(path)["VITE_API_BASE_URL"], "/api")
        for content in [baseline + "AWS_SECRET_ACCESS_KEY=private\n", baseline + "VITE_FIREBASE_API_KEY=duplicate\n",
                        baseline.replace("test-value", "$(secret)", 1), "VITE_GOOGLE_MAPS_KEY=only-one\n"]:
            path.write_text(content)
            with self.assertRaises(local.ReleaseError):
                local.frontend_settings(path)

    def test_external_settings_may_not_point_inside_repository(self):
        with self.assertRaises(local.ReleaseError):
            local.external_path(str(local.ROOT / "ignored-settings.json"))

    def test_bundle_is_deterministic_and_keeps_git_sql_bytes(self):
        files = sources(); files["docs/secret.md"] = b"PRIVATE"; files["client/.env"] = b"PRIVATE"
        images = {key: "sha256:" + "b" * 64 for key in local.COMPONENTS}
        first, second = self.root / "a.tgz", self.root / "b.tgz"
        digest = local.make_bundle(first, files, SHA, PREFIX, images)
        self.assertEqual(digest, local.make_bundle(second, files, SHA, PREFIX, images))
        contents = validator.validate_archive(first, digest, SHA, PREFIX)
        self.assertNotIn("docs/secret.md", contents)
        self.assertNotIn("client/.env", contents)
        self.assertEqual(contents["db/migrations/002_new.sql"], b"SELECT 2;\n")

    def test_git_export_bypasses_windows_archive_crlf_conversion(self):
        def git(*args, data=None):
            return subprocess.check_output(["git", *args], cwd=self.root, input=data, stderr=subprocess.DEVNULL)
        git("init", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid")
        git("config", "core.autocrlf", "true")
        (self.root / "m.sql").write_bytes(b"SELECT 1;\n")
        git("add", "."); git("commit", "-m", "fixture")
        sha = git("rev-parse", "HEAD").decode().strip()
        with patch.object(local, "ROOT", self.root):
            self.assertEqual(local.git_files(sha)["m.sql"], b"SELECT 1;\n")

    def test_git_export_rejects_committed_private_notes(self):
        with patch.object(local, "run", return_value=b"100644 blob " + b"b" * 40 + b"\tdocs/plan.md\0"):
            with self.assertRaises(local.ReleaseError):
                local.git_files(SHA)

    def test_repository_rejects_dirty_wrong_branch_remote_and_unpushed_commit(self):
        config = {"repository": "test/eventmap"}
        baseline = ["", "main", "https://github.com/test/eventmap.git", SHA, SHA]
        for index, bad in [(0, " M README.md"), (1, "feature/x"), (2, "https://github.com/other/repo.git"), (4, "b" * 40)]:
            values = baseline.copy(); values[index] = bad
            with patch.object(local, "command", side_effect=values), self.assertRaises(local.ReleaseError):
                local.repository_state(config)

    def test_ci_is_bound_to_sha_and_rejects_failed_or_unfinished_run(self):
        for run in [[], [{"status": "completed", "conclusion": "failure", "headSha": SHA}],
                    [{"status": "completed", "conclusion": "success", "headSha": "b" * 40}]]:
            with patch.object(local, "command", return_value=json.dumps(run)), self.assertRaises(local.ReleaseError):
                local.wait_for_ci({"repository": "test/eventmap"}, SHA, wait=False)

    def test_registry_redirect_strips_credentials_across_origins(self):
        handler = local.RegistryRedirect()
        request = urllib.request.Request("https://ghcr.io/blob", headers={"Authorization": "Bearer private"})
        redirected = handler.redirect_request(request, None, 302, "Found", {}, "https://cdn.example/image")
        self.assertIsNone(redirected.get_header("Authorization"))
        with self.assertRaises(local.ReleaseError):
            handler.redirect_request(request, None, 302, "Found", {}, "http://cdn.example/image")

    def test_existing_registry_images_are_verified_before_reuse(self):
        config = {"prefix": PREFIX, "repository": "test/eventmap"}
        image = {"os": "linux", "architecture": "amd64", "config": {"Labels": {
            "org.opencontainers.image.revision": SHA, "io.dynamic-event-map.image-prefix": PREFIX,
            "org.opencontainers.image.source": "https://github.com/test/eventmap"}}}
        local.validate_image(image, config, SHA)
        image["config"]["Labels"]["org.opencontainers.image.revision"] = "b" * 40
        with self.assertRaises(local.ReleaseError):
            local.validate_image(image, config, SHA)

    def test_subprocess_failure_redacts_private_log_and_never_echoes_stderr(self):
        path = self.root / "private.log"
        with patch.object(local.subprocess, "run", return_value=subprocess.CompletedProcess(["docker"], 1, b"token=secret", b"private=secret")):
            with self.assertRaises(local.ReleaseError) as failure:
                local.run(["docker"], log=path, sensitive=("secret",))
        self.assertNotIn("secret", str(failure.exception))
        self.assertNotIn(b"secret", path.read_bytes())

    def test_ssh_requires_pinned_identity_and_host_key(self):
        args = local.ssh_arguments({"identity_file": "private.pem", "known_hosts_file": "known_hosts", "host": "server.example", "user": "ubuntu"})
        self.assertIn("StrictHostKeyChecking=yes", args)
        self.assertIn("IdentitiesOnly=yes", args)
        self.assertIn("UserKnownHostsFile=known_hosts", args)
        self.assertEqual(args[-1], "sudo -n python3 -")

    def test_check_mode_never_contacts_server_or_publishes(self):
        config = {"frontend_env": self.root / "frontend.env", "repository": "test/eventmap"}
        with patch.object(local.sys, "argv", ["local_release.py", "--config", "test.json", "--check"]), \
             patch.object(local, "configuration", return_value=config), patch.object(local, "frontend_settings"), \
             patch.object(local, "repository_state", return_value=SHA), patch.object(local, "wait_for_ci"), \
             patch.object(local.shutil, "which", return_value="installed"), patch.object(local, "command", side_effect=["linux", "buildx"]), \
             patch.object(local, "publish") as publish, patch.object(local, "remote_deploy") as remote, contextlib.redirect_stdout(io.StringIO()):
            local.main()
        publish.assert_not_called(); remote.assert_not_called()


class HostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.patches = []
        for name in ("DEPLOY", "STATE", "LEDGERS", "RELEASES", "ACCEPTED", "SEQUENCE_LOCK", "MAINTENANCE_LOCK"):
            value = self.root / name.lower()
            if not name.endswith("LOCK"):
                value.mkdir(mode=0o700)
            item = patch.object(host, name, value); item.start(); self.patches.append(item)
        (host.DEPLOY / ".env").write_text("PRIVATE=not-printed\n")
        (host.DEPLOY / ".release.env").write_text("IMAGE_PREFIX=" + PREFIX + "\nIMAGE_TAG=" + "b" * 40 + "\n")
        self.files = sources()
        self.applied("001_initial")
        images = {key: "sha256:" + "c" * 64 for key in local.COMPONENTS}
        archive = self.root / "bundle.tgz"
        digest = local.make_bundle(archive, self.files, SHA, PREFIX, images)
        self.request = {"sha": SHA, "prefix": PREFIX, "digest": digest, "url": "https://www.example.com",
                        "bundle": base64.b64encode(archive.read_bytes()).decode()}
        self.coordinator = host.Coordinator(self.request, validator)
        self.coordinator.container = "test-container"; self.coordinator.files = validator.validate_archive(archive, digest, SHA, PREFIX)

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def applied(self, name):
        (host.LEDGERS / (name + ".applied")).write_text(hashlib.sha256(self.files["db/migrations/" + name + ".sql"]).hexdigest() + "  migration.sql\n")

    def test_migrations_are_append_only_and_checksum_protected(self):
        _, pending = host.migration_plan(self.files, host.LEDGERS)
        self.assertEqual(pending, ["002_new"])
        (host.LEDGERS / "001_initial.applied").write_text("0" * 64 + "\n")
        with self.assertRaises(host.HostError):
            host.migration_plan(self.files, host.LEDGERS)

    def test_unknown_applied_migration_blocks_rollback(self):
        (host.LEDGERS / "003_future.applied").write_text("0" * 64)
        with self.assertRaises(host.HostError):
            host.migration_plan(self.files, host.LEDGERS)

    def test_gap_or_missing_initial_schema_is_rejected(self):
        (host.LEDGERS / "001_initial.applied").unlink()
        with self.assertRaises(host.HostError):
            host.migration_plan(self.files, host.LEDGERS)
        self.applied("002_new")
        with self.assertRaises(host.HostError):
            host.migration_plan(self.files, host.LEDGERS)

    def test_backup_failure_stops_before_migrations_and_rollout(self):
        ops = self.coordinator
        with patch.object(ops, "run", return_value="test-container"), patch.object(ops, "job", side_effect=host.HostError("backup failed")), \
             patch.object(ops, "migrate") as migrate, patch.object(validator, "install_bundle") as install:
            with self.assertRaises(host.HostError):
                ops.execute()
        migrate.assert_not_called(); install.assert_not_called()

    def test_restore_or_rehearsal_failure_never_touches_production_sql(self):
        for failure in ("restore", "sql"):
            ops = self.coordinator
            ops.state = {"sha": SHA, "digest": self.request["digest"], "backup": "backup_test_x.dump", "backup_at": time.time()}
            calls = []
            def job(*args):
                if failure == "restore":
                    raise host.HostError("restore failed")
                return "RESTORE_SUCCESS target=" + ops.state["recovery"]
            def pg(sql, database=None):
                calls.append(database)
                if sql == "SELECT current_database();":
                    return database
                raise host.HostError("SQL failed")
            with patch.object(ops, "job", side_effect=job), patch.object(ops, "pg", side_effect=pg):
                with self.assertRaises(host.HostError):
                    ops.migrate(*host.migration_plan(self.files, host.LEDGERS))
            self.assertNotIn(None, calls)
            self.assertFalse((host.LEDGERS / "002_new.applied").exists())

    def test_rehearsal_precedes_production_and_ledger_follows_success(self):
        ops = self.coordinator; ops.state.update(backup="backup_test_x.dump", backup_at=time.time())
        calls = []
        def pg(sql, database=None):
            if sql == "SELECT current_database();":
                return database
            calls.append(database)
            if database is None:
                self.assertFalse((host.LEDGERS / "002_new.applied").exists())
                self.assertEqual(ops.state["migration_in_flight"], "002_new")
            return ""
        with patch.object(ops, "job", side_effect=lambda *args: "RESTORE_SUCCESS target=" + ops.state["recovery"]), patch.object(ops, "pg", side_effect=pg):
            ops.migrate(*host.migration_plan(self.files, host.LEDGERS))
        self.assertEqual(calls, [ops.state["recovery"], None])
        self.assertTrue((host.LEDGERS / "002_new.applied").exists())
        self.assertNotIn("migration_in_flight", ops.state)

    def test_interrupted_migration_is_not_replayed(self):
        ops = self.coordinator; ops.state["migration_in_flight"] = "002_new"
        with patch.object(ops, "pg") as pg, self.assertRaises(host.HostError):
            ops.migrate(*host.migration_plan(self.files, host.LEDGERS))
        pg.assert_not_called()

    def test_failed_production_sql_does_not_create_ledger(self):
        ops = self.coordinator
        ops.state.update(rehearsal_complete=True, pending=["002_new"], backup="backup_test_x.dump", backup_at=time.time())
        with patch.object(ops, "pg", side_effect=host.HostError("SQL failed")), self.assertRaises(host.HostError):
            ops.migrate(*host.migration_plan(self.files, host.LEDGERS))
        self.assertFalse((host.LEDGERS / "002_new.applied").exists())
        self.assertEqual(json.loads(ops.evidence.read_text())["migration_in_flight"], "002_new")

    def test_stale_backup_is_not_reused(self):
        ops = self.coordinator; ops.state.update(backup="backup_test_x.dump", backup_at=1)
        with self.assertRaises(host.HostError):
            ops.backup()

    def test_current_release_is_verified_without_backup_or_rollout(self):
        self.applied("002_new")
        (host.DEPLOY / ".release.env").write_text("IMAGE_PREFIX=" + PREFIX + "\nIMAGE_TAG=" + SHA + "\n")
        ops = self.coordinator
        with patch.object(ops, "run", return_value="test-container"), patch.object(ops, "backup") as backup, \
             patch.object(ops, "verify") as verify, patch.object(validator, "install_bundle") as install:
            ops.execute()
        backup.assert_not_called(); install.assert_not_called(); verify.assert_called_once()

    def test_cleanup_only_drops_the_owned_rehearsal_database(self):
        ops = self.coordinator
        for name in ("eventsdb", "recovery_someone_else", "recovery_release_" + "b" * 16 + "_12345678"):
            ops.state.update(recovery=name, rehearsal_complete=True)
            with patch.object(ops, "pg") as pg, self.assertRaises(host.HostError):
                ops.cleanup()
            pg.assert_not_called()
        own = "recovery_release_" + SHA[:16] + "_12345678"
        ops.state.update(recovery=own, rehearsal_complete=True)
        with patch.object(ops, "pg") as pg:
            ops.cleanup()
        pg.assert_called_once_with('DROP DATABASE IF EXISTS "' + own + '";', "postgres")

    def test_release_lock_rejects_a_concurrent_run(self):
        with host.lock(host.SEQUENCE_LOCK), self.assertRaises(host.HostError):
            with host.lock(host.SEQUENCE_LOCK):
                pass


if __name__ == "__main__":
    unittest.main()
