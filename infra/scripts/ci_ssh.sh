#!/usr/bin/env bash
# Source in a GitHub runner shell. The SSH private key never leaves its temp dir.
set -euo pipefail
umask 077
[[ "${DO_SSH_HOST:-}" =~ ^[a-zA-Z0-9.-]+$ ]] || { echo "Invalid SSH hostname" >&2; exit 1; }
[[ "${DO_SSH_USER:-}" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || { echo "Invalid SSH user" >&2; exit 1; }
[[ "${DO_SSH_FINGERPRINT:-}" =~ ^SHA256:[a-zA-Z0-9+/]+$ ]] || { echo "Set the verified SHA256 SSH host fingerprint" >&2; exit 1; }
SSH_WORK=$(mktemp -d "${RUNNER_TEMP:-/tmp}/eventmap-ssh.XXXXXXXX")
ssh_cleanup() {
  [[ -z "${SSH_AGENT_PID:-}" ]] || ssh-agent -k >/dev/null || true
  rm -rf -- "$SSH_WORK"
}
trap ssh_cleanup EXIT
printf '%s\n' "${DO_SSH_KEY:?Set the deployment SSH key}" > "$SSH_WORK/key"
ssh-keyscan -T 10 -H "$DO_SSH_HOST" > "$SSH_WORK/scanned" 2>/dev/null
: > "$SSH_WORK/known_hosts"
while IFS= read -r host_key; do
  printf '%s\n' "$host_key" > "$SSH_WORK/candidate"
  fingerprint=$(ssh-keygen -lf "$SSH_WORK/candidate" -E sha256 | awk '{print $2}')
  if [[ "$fingerprint" == "$DO_SSH_FINGERPRINT" ]]; then
    printf '%s\n' "$host_key" >> "$SSH_WORK/known_hosts"
  fi
done < "$SSH_WORK/scanned"
[[ -s "$SSH_WORK/known_hosts" ]] || { echo "SSH host fingerprint mismatch" >&2; exit 1; }
eval "$(ssh-agent -s)" >/dev/null
printf '#!/bin/sh\nprintf "%%s\\n" "$DO_SSH_PASSPHRASE"\n' > "$SSH_WORK/askpass"
chmod 700 "$SSH_WORK/askpass"
export DO_SSH_PASSPHRASE="${DO_SSH_PASSPHRASE:-}"
SSH_ASKPASS="$SSH_WORK/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=eventmap ssh-add "$SSH_WORK/key" </dev/null
unset DO_SSH_KEY DO_SSH_PASSPHRASE
ssh_ci() {
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes \
    -o "UserKnownHostsFile=$SSH_WORK/known_hosts" -i "$SSH_WORK/key" \
    "$DO_SSH_USER@$DO_SSH_HOST" "$@"
}
