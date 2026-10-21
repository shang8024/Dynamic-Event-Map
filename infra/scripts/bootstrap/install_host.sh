#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" == 0 ]] || { echo "Run as root (sudo)" >&2; exit 1; }
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo "This bootstrap targets Ubuntu 24.04" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

if ! command -v docker >/dev/null; then
  # Official Docker apt repository; do not execute a downloaded convenience script.
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  install -d -m 755 /etc/docker
  if [[ ! -f /etc/docker/daemon.json ]]; then
    printf '%s\n' '{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' > /etc/docker/daemon.json
    systemctl restart docker
  fi
fi
systemctl is-active --quiet docker

# Small launch VM: add a bounded swap file only when none exists. Never replace one.
MEMORY_KIB=$(awk '/MemTotal:/{print $2}' /proc/meminfo)
if ((MEMORY_KIB < 3000000)) && [[ -z "$(swapon --show --noheadings)" ]]; then
  [[ ! -e /swapfile ]] || { echo "Existing /swapfile found; inspect it manually" >&2; exit 1; }
  FREE_KIB=$(df --output=avail / | tail -n 1)
  ((FREE_KIB > 4194304)) || { echo "Insufficient free disk for a 2 GiB swap file" >&2; exit 1; }
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -qE '^/swapfile[[:space:]]' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi
docker version --format 'Docker server {{.Server.Version}}'
docker compose version
free -m
echo "Host installation complete. No Docker TCP port or application port was published."
