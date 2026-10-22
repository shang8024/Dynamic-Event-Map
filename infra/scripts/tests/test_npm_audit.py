import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock


spec = importlib.util.spec_from_file_location("npm_audit", Path(__file__).parents[1] / "npm_audit.py")
npm_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(npm_audit)


def report(*, high=0, critical=0, moderate=0, status=0):
    return subprocess.CompletedProcess([], status, json.dumps({
        "vulnerabilities": {}, "metadata": {"vulnerabilities": {
            "info": 0, "low": 0, "moderate": moderate, "high": high,
            "critical": critical, "total": high + critical + moderate,
        }},
    }), "")


def failure(code):
    return subprocess.CompletedProcess([], 1, json.dumps({"error": {"code": code}}), "")


class AuditRetryTests(unittest.TestCase):
    def run_audit(self, results):
        execute = Mock(side_effect=results)
        sleep, emit = Mock(), Mock()
        status = npm_audit.audit("api", execute=execute, sleep=sleep, emit=emit)
        return status, execute, sleep

    def test_clean_or_below_threshold_reports_pass_without_retry(self):
        for result in (report(), report(moderate=2)):
            with self.subTest(result=result):
                status, execute, sleep = self.run_audit([result])
                self.assertEqual(status, 0)
                execute.assert_called_once()
                sleep.assert_not_called()

    def test_high_vulnerabilities_fail_immediately_even_with_inconsistent_exit_code(self):
        for result in (report(high=1, status=1), report(high=1, status=0), report(critical=1, status=1)):
            with self.subTest(result=result):
                status, execute, sleep = self.run_audit([result, report()])
                self.assertEqual(status, 1)
                execute.assert_called_once()
                sleep.assert_not_called()

    def test_registry_503_retries_and_can_recover(self):
        for content in ({"error": {"code": "E503"}},
                        {"statusCode": 503, "message": "503 Service Unavailable", "error": {"summary": ""}},
                        {"message": "network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk", "error": {}},
                        {"message": "request failed, reason: read ECONNRESET", "error": {}}):
            with self.subTest(content=content):
                error = subprocess.CompletedProcess([], 1, json.dumps(content), "")
                status, execute, sleep = self.run_audit([error, report()])
                self.assertEqual(status, 0)
                self.assertEqual(execute.call_count, 2)
                sleep.assert_called_once_with(10)

    def test_timeout_and_network_failure_have_a_finite_budget(self):
        status, execute, sleep = self.run_audit([
            subprocess.TimeoutExpired("npm", 50), failure("ECONNRESET"), failure("E503"),
        ])
        self.assertEqual(status, 1)
        self.assertEqual(execute.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [10, 20])
        self.assertTrue(all(call.kwargs["timeout"] == 50 for call in execute.call_args_list))

    def test_missing_lockfile_and_credentials_are_not_retryable(self):
        for code in ("ENOLOCK", "EAUDITNOLOCK", "E401", "E403"):
            with self.subTest(code=code):
                status, execute, sleep = self.run_audit([failure(code), report()])
                self.assertEqual(status, 1)
                execute.assert_called_once()
                sleep.assert_not_called()

    def test_malformed_or_incomplete_success_responses_fail_closed(self):
        for content in ("not json", "null", "[]", "{}", '{"metadata":null}',
                        '{"metadata":{"vulnerabilities":{}}}', '{"error":{"code":[]}}'):
            with self.subTest(content=content):
                status, execute, sleep = self.run_audit([subprocess.CompletedProcess([], 0, content, "")])
                self.assertEqual(status, 1)
                execute.assert_called_once()
                sleep.assert_not_called()

    def test_missing_npm_and_unexpected_exit_codes_fail_without_retry(self):
        for result in (FileNotFoundError(), report(status=2)):
            with self.subTest(result=result):
                status, execute, sleep = self.run_audit([result])
                self.assertEqual(status, 1)
                execute.assert_called_once()
                sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
