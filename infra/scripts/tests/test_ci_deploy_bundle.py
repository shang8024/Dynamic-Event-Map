"""Host bootstrap tests only inside an explicitly enabled, disposable Docker container."""
import hashlib
import os
from pathlib import Path
import shutil
import stat
import subprocess
import unittest

from test_ci_deploy_lightsail import PREFIX, SHA, SCRIPT, bundle_at, contents


ENABLED = (os.environ.get("EVENTMAP_CD_BUNDLE_TEST") == "1" and os.name == "posix" and
           os.geteuid() == 0 and Path("/.dockerenv").is_file())


@unittest.skipUnless(ENABLED, "Explicit disposable Docker container required for fixed host paths")
class HostBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.roots = [Path("/root/deploy"), Path("/root/eventmap-releases"), Path("/home/ubuntu/eventmap-inbound-12345-2"),
                      Path("/var/lib/eventmap"), Path("/var/log/eventmap-ci-deploy")]
        for root in self.roots:
            if root.exists():
                shutil.rmtree(root)
        self.inbound = self.roots[2]
        self.inbound.mkdir(mode=0o700, parents=True)
        shutil.copy2(SCRIPT, self.inbound / SCRIPT.name)
        shutil.copy2(SCRIPT.with_name("deploy_bundle.sh"), self.inbound / "deploy_bundle.sh")
        installed = Path("/root/deploy/infra/scripts")
        installed.mkdir(mode=0o700, parents=True)
        self.env = Path("/root/deploy/.env");self.env.write_text("protected-existing-host-configuration\n");self.env.chmod(0o600)
        self.sequence = Path("/tmp/eventmap-ci-deploy-sequence")
        self.sequence.unlink(missing_ok=True)

    def prepare(self, *, backup_ok=True, deploy_ok=True, migration=True):
        files = contents()
        files["infra/scripts/deploy.sh"] = ("#!/bin/bash\nprintf 'deploy\\n' >> /tmp/eventmap-ci-deploy-sequence\n" +
                                              ("exit 0\n" if deploy_ok else "exit 4\n")).encode()
        _bundle, digest = bundle_at(self.inbound, files)
        Path("/root/deploy/infra/scripts/run_swarm_job.sh").write_text(
            "#!/bin/bash\n[[ \"$1\" == backup && \"$JOB_TIMEOUT_SECONDS\" == 1200 ]] || exit 3\n" +
            "printf 'backup\\n' >> /tmp/eventmap-ci-deploy-sequence\n" + ("exit 0\n" if backup_ok else "exit 5\n"))
        if migration:
            ledger = Path("/var/lib/eventmap/migrations/001_example.applied")
            ledger.parent.mkdir(mode=0o700, parents=True)
            ledger.write_text(hashlib.sha256(files["db/migrations/001_example.sql"]).hexdigest() + " migration.sql\n");ledger.chmod(0o600)
        return digest

    def run_bootstrap(self, digest):
        return subprocess.run(["bash", str(self.inbound / "deploy_bundle.sh"), SHA, PREFIX, digest], capture_output=True, text=True, timeout=20)

    def assert_configuration_preserved(self):
        self.assertEqual(self.env.read_text(), "protected-existing-host-configuration\n")

    def test_missing_migration_stops_before_backup_and_rollout(self):
        result = self.run_bootstrap(self.prepare(migration=False))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.sequence.exists())
        self.assertFalse((Path("/root/eventmap-releases") / SHA).exists())
        self.assert_configuration_preserved()

    def test_backup_failure_never_requests_rollout(self):
        result = self.run_bootstrap(self.prepare(backup_ok=False))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.sequence.read_text(), "backup\n")
        self.assertIn("no rollout requested", result.stderr)
        self.assert_configuration_preserved()

    def test_backup_precedes_deployment_and_private_log_is_preserved(self):
        result = self.run_bootstrap(self.prepare())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.sequence.read_text(), "backup\ndeploy\n")
        logs = list(Path("/var/log/eventmap-ci-deploy").glob("*.log"))
        self.assertEqual(len(logs), 1);self.assertEqual(stat.S_IMODE(logs[0].stat().st_mode), 0o600)
        self.assert_configuration_preserved()

    def test_rollout_failure_retains_previous_configuration_and_candidate(self):
        result = self.run_bootstrap(self.prepare(deploy_ok=False))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.sequence.read_text(), "backup\ndeploy\n")
        self.assertTrue((Path("/root/eventmap-releases") / SHA / ".bundle.sha256").is_file())
        self.assertIn("Previous release files are retained", result.stderr)
        self.assert_configuration_preserved()


if __name__ == "__main__":
    unittest.main()
