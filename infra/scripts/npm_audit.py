"""Bound registry outages without allowing a failed security audit to pass CI."""
import argparse
import json
import re
import shutil
import subprocess
import time


ATTEMPTS = 3
ATTEMPT_TIMEOUT = 50
TRANSIENT_ERRORS = {
    "E408", "E429", "E500", "E502", "E503", "E504",
    "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ESOCKETTIMEDOUT",
    "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH",
}
TRANSIENT_STATUS = {408, 429, 500, 502, 503, 504}


def log(message):
    print(message, flush=True)


def audit(directory, *, execute=subprocess.run, sleep=time.sleep, emit=log):
    command = [shutil.which("npm") or "npm", "audit", "--prefix", directory,
               "--audit-level=high", "--json", "--fetch-retries=0", "--fetch-timeout=20000"]
    for attempt in range(1, ATTEMPTS + 1):
        emit(f"Auditing {directory}: attempt {attempt}/{ATTEMPTS}")
        try:
            result = execute(command, capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=ATTEMPT_TIMEOUT)
        except subprocess.TimeoutExpired:
            reason = "audit process timed out"
        except OSError:
            emit("Cannot start npm audit; security verification failed.")
            return 1
        else:
            try:
                report = json.loads(result.stdout)
            except (ValueError, TypeError):
                report = None
            if not isinstance(report, dict):
                emit("Invalid npm audit response; security verification failed.")
                return 1
            metadata = report.get("metadata")
            counts = metadata.get("vulnerabilities") if isinstance(metadata, dict) else None
            if (not report.get("error") and isinstance(report.get("vulnerabilities"), dict)
                    and isinstance(counts, dict)
                    and all(type(counts.get(key)) is int and counts[key] >= 0
                            for key in ("info", "low", "moderate", "high", "critical", "total"))):
                emit(json.dumps(report, indent=2))
                # A vulnerability report is final, never a reason to retry.
                return 0 if result.returncode == 0 and counts["high"] == counts["critical"] == 0 else 1
            error = report.get("error")
            code = report.get("code") or (error.get("code") if isinstance(error, dict) else None)
            status = report.get("statusCode")
            message = report.get("message")
            # npm's audit endpoint errors expose statusCode at the top level;
            # timeouts sometimes only retain a message and an empty error object.
            timeout = isinstance(message, str) and message.startswith("network timeout at:")
            network = isinstance(message, str) and re.search(
                r"\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)\b|socket hang up",
                message)
            transient = (type(status) is int and status in TRANSIENT_STATUS) or (
                status is None and ((isinstance(code, str) and code in TRANSIENT_ERRORS)
                                    or (code is None and (timeout or network))))
            if not transient:
                emit("npm audit failed without a retryable registry error; security verification failed.")
                return 1
            reason = f"temporary registry/network error ({status or code or 'connection failure'})"
        if attempt == ATTEMPTS:
            emit(f"Audit unavailable after {ATTEMPTS} attempts: {reason}. Security verification failed.")
            return 1
        delay = attempt * 10
        emit(f"Retrying in {delay}s after {reason}.")
        sleep(delay)
    return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", choices=("api", "client"))
    raise SystemExit(audit(parser.parse_args().directory))
