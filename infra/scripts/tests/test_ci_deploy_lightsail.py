"""Offline deployment boundary tests. No AWS, network or SSH commands execute."""
import base64
import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import struct
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "ci_deploy_lightsail.py"
spec = importlib.util.spec_from_file_location("eventmap_ci_deploy", SCRIPT)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
SHA = "a" * 40
PREFIX = "ghcr.io/test/eventmap-production"
NOW = dt.datetime(2026, 10, 21, tzinfo=dt.timezone.utc)


def public_key():
    tag = b"ssh-ed25519"
    raw = struct.pack(">I", len(tag)) + tag + struct.pack(">I", 32) + b"k" * 32
    return {"algorithm": tag.decode(), "publicKey": base64.b64encode(raw).decode(),
            "fingerprintSHA256": "SHA256:" + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")}


def access():
    return {"protocol": "ssh", "instanceName": "eventmap-production", "username": "ubuntu", "ipAddress": "8.8.8.8",
            "expiresAt": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).isoformat(),
            "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n" + "A" * 100 + "\n-----END RSA PRIVATE KEY-----\n",
            "certKey": "ssh-rsa-cert-v01@openssh.com AAAA", "hostKeys": [public_key()]}


def contents(sha=SHA, prefix=PREFIX):
    return {"release.env": f"IMAGE_PREFIX={prefix}\nIMAGE_TAG={sha}\n".encode(),
            "images.lock": "".join(f"{component}=sha256:{'b' * 64}\n" for component in ("api", "client", "events-ingest", "db-backup")).encode(),
            "stack.yml": b"services: {}\n", "stack.notifications.yml": b"services: {}\n",
            "stack.notifications.identity.yml": b"services: {}\n", "db/init.sql": b"SELECT 1;\n",
            "db/migrations/001_example.sql": b"SELECT 2;\n", "infra/scripts/deploy.sh": b"#!/bin/bash\nexit 0\n"}


def bundle_at(root, files=None, special=None):
    target = root / "eventmap-release.tar.gz"
    with tarfile.open(target, "w:gz") as archive:
        for name, data in (files or contents()).items():
            info = tarfile.TarInfo(name);info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
        if special:
            archive.addfile(special)
    return target, hashlib.sha256(target.read_bytes()).hexdigest()


class FakeCommands:
    def __init__(self, state_path, rules=None, fail=None):
        self.state_path, self.rules, self.fail, self.calls = state_path, rules or [], fail, []
        self.created = False;self.freeze_close = False

    def __call__(self, args, **options):
        self.calls.append((args, options))
        if args[0] == "aws":
            operation = args[args.index("lightsail") + 1]
            if operation == "get-instance":
                return json.dumps({"instance": {"name": "eventmap-production", "location": {"regionName": "ca-central-1"}, "state": {"name": "running"}, "publicIpAddress": "8.8.8.8"}})
            if operation == "get-instance-access-details":
                return json.dumps({"accessDetails": access()})
            if operation == "get-instance-port-states":
                own = [{"fromPort": 22, "toPort": 22, "protocol": "tcp", "state": "open", "cidrs": ["1.2.3.4/32"]}] if self.created else []
                return json.dumps({"portStates": self.rules + own})
            if operation == "open-instance-public-ports":
                assert json.loads(self.state_path.read_text())["open_intent"] is True
                self.created = True
            if operation == "close-instance-public-ports" and not self.freeze_close:
                self.created = False
            if operation == self.fail:
                raise deploy.DeployError("Mocked ambiguous operation failure")
            return "{}"
        if args[0] == self.fail:
            raise deploy.DeployError("Mocked transport failure")
        if args[:2] == ["ssh-keygen", "-L"]:
            now = dt.datetime.now(dt.timezone.utc)
            return f"    Valid: from {(now - dt.timedelta(minutes=1)):%Y-%m-%dT%H:%M:%S} to {(now + dt.timedelta(hours=1)):%Y-%m-%dT%H:%M:%S}\n"
        return ""

    def operations(self):
        return [args[args.index("lightsail") + 1] for args, _ in self.calls if args[0] == "aws"]


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_complete_artifact_validates_and_checksum_mismatch_fails(self):
        bundle, digest = bundle_at(self.root)
        self.assertEqual(deploy.validate_archive(bundle, digest, SHA, PREFIX), contents())
        with self.assertRaisesRegex(deploy.DeployError, "checksum"):
            deploy.validate_archive(bundle, "0" * 64, SHA, PREFIX)

    def test_metadata_mismatch_and_nonfull_sha_fail(self):
        bundle, digest = bundle_at(self.root, contents(sha="c" * 40))
        with self.assertRaisesRegex(deploy.DeployError, "metadata"):
            deploy.validate_archive(bundle, digest, SHA, PREFIX)
        for sha in ("abc", "a" * 39, "A" * 40, "a" * 40 + ";echo injected"):
            with self.assertRaises(deploy.DeployError):
                deploy.validate_archive(bundle, digest, sha, PREFIX)

    def test_traversal_unexpected_credentials_and_duplicate_paths_fail(self):
        for name in ("../outside", "/root/.env", "infra/scripts/../../outside", "infra/scripts/key.pem", "db/.env", "client/index.html"):
            files = contents();files[name] = b"secret"
            bundle, digest = bundle_at(self.root, files)
            with self.subTest(name=name), self.assertRaises(deploy.DeployError):
                deploy.validate_archive(bundle, digest, SHA, PREFIX)
        info = tarfile.TarInfo("stack.yml");info.size = 0
        bundle, digest = bundle_at(self.root, special=info)
        with self.assertRaisesRegex(deploy.DeployError, "duplicate"):
            deploy.validate_archive(bundle, digest, SHA, PREFIX)

    def test_symlinks_and_hardlinks_fail(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
            info = tarfile.TarInfo("infra/scripts/link.sh");info.type = kind;info.linkname = "/etc/passwd"
            bundle, digest = bundle_at(self.root, special=info)
            with self.subTest(kind=kind), self.assertRaisesRegex(deploy.DeployError, "Links"):
                deploy.validate_archive(bundle, digest, SHA, PREFIX)

    @unittest.skipUnless(os.name == "posix" and os.geteuid() == 0, "Root-owned Linux candidate test")
    def test_migration_gate_precedes_candidate_and_reuse_is_immutable(self):
        bundle, digest = bundle_at(self.root)
        releases, ledgers = self.root / "releases", self.root / "ledgers"
        ledgers.mkdir()
        with self.assertRaisesRegex(deploy.DeployError, "migration"):
            deploy.install_bundle(bundle, digest, SHA, PREFIX, releases, ledgers)
        self.assertFalse(releases.exists())
        ledger = ledgers / "001_example.applied"
        ledger.write_text(hashlib.sha256(contents()["db/migrations/001_example.sql"]).hexdigest() + " migration.sql\n");ledger.chmod(0o600)
        candidate = deploy.install_bundle(bundle, digest, SHA, PREFIX, releases, ledgers)
        self.assertEqual(stat.S_IMODE(candidate.stat().st_mode), 0o700)
        self.assertEqual(deploy.install_bundle(bundle, digest, SHA, PREFIX, releases, ledgers), candidate)
        files = contents();files["stack.yml"] = b"services: {different: {}}\n"
        bundle, new_digest = bundle_at(self.root, files)
        with self.assertRaisesRegex(deploy.DeployError, "never overwrite"):
            deploy.install_bundle(bundle, new_digest, SHA, PREFIX, releases, ledgers)
        self.assertEqual((candidate / "stack.yml").read_bytes(), contents()["stack.yml"])


class TrustTests(unittest.TestCase):
    def test_missing_aws_expiry_uses_the_actual_certificate_gate(self):
        value = access();value.pop("expiresAt")
        deploy.validate_access(value, "eventmap-production", "8.8.8.8", "ubuntu", NOW)
        deploy.validate_certificate_lifetime("    Valid: from 2026-10-20T23:59:00 to 2026-10-21T01:00:00\n", NOW)

    def test_certificate_must_have_one_bounded_current_validity(self):
        for description in ("", "Valid: forever", "Valid: after 2026-10-20T00:00:00",
                            "Valid: from 2026-10-20T00:00:00 to 2026-10-20T23:59:00",
                            "Valid: from 2026-10-21T01:00:00 to 2026-10-21T02:00:00",
                            "Valid: from 2026-10-20T00:00:00 to 2026-10-21T00:01:00",
                            "Valid: from 2026-10-20T00:00:00 to 2026-10-23T00:00:00",
                            "Valid: from 2026-10-20T23:59:00 to 2026-10-21T01:00:00\n" * 2):
            with self.subTest(description=description), self.assertRaises(deploy.DeployError):
                deploy.validate_certificate_lifetime(description, NOW)

    def test_host_public_key_and_fingerprint_must_match_aws(self):
        self.assertIn("8.8.8.8 ssh-ed25519", deploy.host_key_lines([public_key()], "8.8.8.8"))
        bad = public_key();bad["fingerprintSHA256"] = "SHA256:wrong"
        for keys in ([], [bad], [{**public_key(), "publicKey": "not a key"}], [{**public_key(), "algorithm": "x509-cert"}]):
            with self.subTest(keys=keys), self.assertRaises(deploy.DeployError):
                deploy.host_key_lines(keys, "8.8.8.8")

    def test_target_identity_ip_and_expiry_are_checked(self):
        for changes in ({"instanceName": "other"}, {"username": "root"}, {"ipAddress": "1.1.1.1"}, {"expiresAt": NOW.isoformat()}, {"hostKeys": []}):
            value = access();value["expiresAt"] = (NOW + dt.timedelta(hours=1)).isoformat();value.update(changes)
            with self.subTest(changes=changes), self.assertRaises(deploy.DeployError):
                deploy.validate_access(value, "eventmap-production", "8.8.8.8", "ubuntu", NOW)

    def test_only_covering_open_tcp_rules_prevent_a_temporary_rule(self):
        rule = {"fromPort": 20, "toPort": 25, "protocol": "tcp", "state": "open", "cidrs": ["1.2.0.0/16"]}
        self.assertTrue(deploy.port_covers([rule], "1.2.3.4"))
        for changes in ({"state": "closed"}, {"protocol": "udp"}, {"fromPort": 80, "toPort": 80}, {"cidrs": ["2.2.0.0/16"]}):
            self.assertFalse(deploy.port_covers([{**rule, **changes}], "1.2.3.4"))


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.root = Path(self.temp.name)
        self.state = self.root / "state.json"
        self.environment = patch.dict(os.environ, {"RUNNER_TEMP": str(self.root), "GITHUB_RUN_ID": "12345", "GITHUB_RUN_ATTEMPT": "2"})
        self.environment.start();self.bundle, self.digest = bundle_at(self.root)

    def tearDown(self):
        self.environment.stop();self.temp.cleanup()

    def session(self, **kwargs):
        fake = FakeCommands(self.state, **kwargs)
        session = deploy.LightsailDeployment(self.state, command=fake, address_lookup=lambda: "1.2.3.4")
        return session, fake

    def prepare(self, session):
        return session.prepare(region="ca-central-1", instance="eventmap-production", sha=SHA, prefix=PREFIX, bundle=self.bundle)

    def test_aws_can_omit_expiry_when_the_actual_certificate_is_valid(self):
        value = access();value.pop("expiresAt")
        session, fake = self.session()
        try:
            with patch(__name__ + ".access", return_value=value):
                self.prepare(session)
            self.assertIn("open-instance-public-ports", fake.operations())
            self.assertTrue(any(args[:2] == ["ssh-keygen", "-L"] for args, _ in fake.calls))
        finally:
            session.cleanup()

    def test_missing_expiry_never_bypasses_certificate_check_before_opening_ssh(self):
        value = access();value.pop("expiresAt")
        session, fake = self.session()
        def invalid_certificate(args, **options):
            return "Valid: forever" if args[:2] == ["ssh-keygen", "-L"] else fake(args, **options)
        session.command = invalid_certificate
        try:
            with patch(__name__ + ".access", return_value=value), self.assertRaises(deploy.DeployError):
                self.prepare(session)
            self.assertNotIn("open-instance-public-ports", fake.operations())
            self.assertFalse(any(args[0] in ("ssh", "scp") for args, _ in fake.calls))
        finally:
            session.cleanup()

    def test_scp_failure_cleans_only_own_rule_and_keys_with_strict_host_checking(self):
        session, fake = self.session(fail="scp")
        bundle, digest = self.prepare(session)
        try:
            with self.assertRaises(deploy.DeployError):
                session.deploy(sha=SHA, prefix=PREFIX, bundle=bundle, bundle_digest=digest)
        finally:
            session.cleanup()
        operations = fake.operations()
        self.assertEqual(operations.count("open-instance-public-ports"), 1)
        self.assertEqual(operations.count("close-instance-public-ports"), 1)
        self.assertNotIn("put-instance-public-ports", operations)
        for args, _ in fake.calls:
            if args[0] == "aws" and args[args.index("lightsail") + 1] in {"open-instance-public-ports", "close-instance-public-ports"}:
                self.assertEqual(json.loads(args[args.index("--port-info") + 1]), {"fromPort": 22, "toPort": 22, "protocol": "tcp", "cidrs": ["1.2.3.4/32"]})
            if args[0] == "ssh":
                self.assertIn("StrictHostKeyChecking=yes", args);self.assertIn("PasswordAuthentication=no", args)
        self.assertFalse(self.state.exists());self.assertFalse((self.root / "eventmap-cd-12345-2").exists())

    def test_existing_exact_or_broader_rule_is_never_closed(self):
        for cidr in ("1.2.3.4/32", "1.2.0.0/16", "0.0.0.0/0"):
            rules = [{"fromPort": 22, "toPort": 22, "protocol": "tcp", "state": "open", "cidrs": [cidr]}]
            session, fake = self.session(rules=rules, fail="scp")
            bundle, digest = self.prepare(session)
            try:
                with self.assertRaises(deploy.DeployError):
                    session.deploy(sha=SHA, prefix=PREFIX, bundle=bundle, bundle_digest=digest)
            finally:
                session.cleanup()
            self.assertNotIn("open-instance-public-ports", fake.operations());self.assertNotIn("close-instance-public-ports", fake.operations())

    def test_ambiguous_open_failure_still_closes_exact_intended_rule(self):
        session, fake = self.session(fail="open-instance-public-ports")
        try:
            with self.assertRaises(deploy.DeployError):
                self.prepare(session)
        finally:
            session.cleanup()
        self.assertIn("close-instance-public-ports", fake.operations());self.assertFalse(self.state.exists())

    def test_firewall_close_failure_retains_protected_state_for_always_step(self):
        session, fake = self.session(fail="close-instance-public-ports")
        self.prepare(session)
        with self.assertRaisesRegex(deploy.DeployError, "retry the cleanup"):
            session.cleanup()
        self.assertTrue(self.state.exists());self.assertTrue(json.loads(self.state.read_text())["open_intent"])
        self.assertFalse((self.root / "eventmap-cd-12345-2").exists())
        fake.fail = None
        session.cleanup();self.assertFalse(self.state.exists())

    def test_remote_cleanup_failure_cannot_skip_closing_firewall_or_removing_keys(self):
        session, fake = self.session(fail="scp")
        bundle, digest = self.prepare(session)
        with self.assertRaises(deploy.DeployError):
            session.deploy(sha=SHA, prefix=PREFIX, bundle=bundle, bundle_digest=digest)
        fake.fail = "ssh"
        with self.assertRaisesRegex(deploy.DeployError, "host-side cleanup"):
            session.cleanup()
        self.assertIn("close-instance-public-ports", fake.operations())
        self.assertFalse((self.root / "eventmap-cd-12345-2").exists())
        self.assertFalse(json.loads(self.state.read_text())["open_intent"])

    def test_state_write_failure_during_remote_cleanup_still_closes_firewall(self):
        session, fake = self.session()
        bundle, digest = self.prepare(session)
        session.deploy(sha=SHA, prefix=PREFIX, bundle=bundle, bundle_digest=digest)
        with patch.object(session, "save_state", side_effect=OSError("disk full")):
            with self.assertRaises(deploy.DeployError):
                session.cleanup()
        self.assertIn("close-instance-public-ports", fake.operations())
        self.assertFalse((self.root / "eventmap-cd-12345-2").exists())

    def test_remote_process_group_and_local_ssh_have_bounded_cleanup_margin(self):
        session, fake = self.session()
        bundle, digest = self.prepare(session)
        session.deploy(sha=SHA, prefix=PREFIX, bundle=bundle, bundle_digest=digest)
        remote = [(args, options) for args, options in fake.calls if args[0] == "ssh" and "--kill-after=30s" in args[-1]]
        self.assertEqual(len(remote), 1)
        self.assertIn("2300s", remote[0][0][-1]);self.assertEqual(remote[0][1]["timeout"], 2450)
        session.cleanup()

    def test_cleanup_without_state_does_not_require_a_role_session(self):
        with patch.dict(os.environ, {"AWS_ACCESS_KEY_ID": "", "AWS_SECRET_ACCESS_KEY": "", "AWS_SESSION_TOKEN": ""}), contextlib.redirect_stdout(io.StringIO()):
            deploy.main(["cleanup", "--state", str(self.root / "not-created.json")])

    def test_accepted_close_must_be_confirmed_before_cleanup_state_is_deleted(self):
        session, fake = self.session()
        self.prepare(session);fake.freeze_close = True
        with patch.object(deploy.time, "sleep", return_value=None), self.assertRaisesRegex(deploy.DeployError, "retry the cleanup"):
            session.cleanup()
        self.assertTrue(self.state.exists());self.assertTrue(json.loads(self.state.read_text())["open_intent"])
        fake.freeze_close = False
        session.cleanup();self.assertFalse(self.state.exists())

    def test_open_and_close_confirm_only_the_run_exact_tcp_22_cidr(self):
        session, fake = self.session()
        self.prepare(session)
        self.assertTrue(fake.created)
        session.cleanup();self.assertFalse(fake.created)
        operations = fake.operations()
        self.assertGreaterEqual(operations.count("get-instance-port-states"), 3)

    @unittest.skipUnless(os.name == "posix", "POSIX protected cleanup state")
    def test_always_step_can_finish_firewall_cleanup_from_protected_state(self):
        session, fake = self.session(fail="close-instance-public-ports")
        self.prepare(session)
        with self.assertRaises(deploy.DeployError):
            session.cleanup()
        fake.fail = None
        next_step = deploy.LightsailDeployment(self.state, command=fake, address_lookup=lambda: "1.2.3.4")
        next_step.cleanup()
        self.assertFalse(self.state.exists())


if __name__ == "__main__":
    unittest.main()
