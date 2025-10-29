#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/root"                       
INFRA_DIR_NAME="infra"

if [ -d "/root/${INFRA_DIR_NAME}" ]; then
  INFRA="/root/${INFRA_DIR_NAME}"
else
  INFRA="$(dirname "$(find /root -maxdepth 2 -type d -name "${INFRA_DIR_NAME}" | head -n1)")/${INFRA_DIR_NAME}"
fi
[ -d "$INFRA" ] || { echo "[x] infra dir not found under /root. abort."; exit 1; }

echo "[*] Using INFRA: $INFRA"

# dependencies + setup
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y awscli logrotate jq curl ca-certificates

# env
mkdir -p "$INFRA/env"
if [ ! -f "$INFRA/env/.env.backup" ]; then
  cp "$INFRA/env/.env.backup.example" "$INFRA/env/.env.backup"
  echo "[!] please fill in Spaces/DO values in $INFRA/env/.env.backup"
fi

# local backup dir
ENV_FILE="$INFRA/env/.env.backup"
BACKUP_ROOT="$(grep -E '^BACKUP_ROOT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
BACKUP_ROOT="${BACKUP_ROOT:-/mnt/pgdata/backups}"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

echo "[*] BACKUP_ROOT: $BACKUP_ROOT"

# install systemd units + timers
install_unit() {
  local svc="$1"
  local timer="$2"
  local src_dir="$3"

  cp "$src_dir/$svc"   "/etc/systemd/system/$svc"
  cp "$src_dir/$timer" "/etc/systemd/system/$timer"
  systemctl daemon-reload
  systemctl enable --now "$timer"
  echo "    enabled: $timer"
}

install_all_bins() {
  local src_root="${1:-/root/deploy/infra/scripts}"
  local dest_dir="${2:-/usr/local/bin}"

  echo "[*] Installing shell scripts from: $src_root -> $dest_dir"
  mkdir -p "$dest_dir"

  mapfile -t scripts < <(find "$src_root" -maxdepth 2 -type f -name '*.sh' | sort)

  if [ "${#scripts[@]}" -eq 0 ]; then
    echo "WARN: no scripts found under $src_root/*/*.sh"
    return 0
  fi

  for src in "${scripts[@]}"; do
    local base dst tmp
    base="$(basename "$src")"
    dst="$dest_dir/$base"

    if command -v dos2unix >/dev/null 2>&1; then
      dos2unix -q "$src" || true
    else
      sed -i 's/\r$//' "$src"
    fi

    if ! head -n1 "$src" | grep -qE '^#!'; then
      tmp="$(mktemp)"
      printf '%s\n' '#!/usr/bin/env bash' > "$tmp"
      cat "$src" >> "$tmp"
      mv "$tmp" "$src"
    fi

    install -Dm755 "$src" "$dst"
    printf '    [✓] %s -> %s\n' "$src" "$dst"
  done

  echo "[*] Installed scripts:"
  ls -l "$dest_dir"/*.sh 2>/dev/null || true
}

install_all_bins

# echo "[*] Installing backup timers..."
# install_unit "db-backup.service"    "db-backup.timer"    "$INFRA/system/db-backup"

echo "[*] Installing docker-clean timers..."
install_unit "docker-clean.service" "docker-clean.timer" "$INFRA/system/docker-clean"

# read env in systemd units
SED_ENV='s|^EnvironmentFile=.*|EnvironmentFile='"$INFRA"'/env/.env.backup|g'
for S in /etc/systemd/system/*.service; do
  if grep -q 'EnvironmentFile=' "$S"; then
    sed -i "$SED_ENV" "$S"
  fi
done
systemctl daemon-reload

# logrotate
echo "[*] Installing logrotate configs..."
cp "$INFRA/logrotate/nginx"        /etc/logrotate.d/nginx
cp "$INFRA/logrotate/docker-clean" /etc/logrotate.d/docker-clean
logrotate -d /etc/logrotate.conf >/dev/null || true
echo "    logrotate dry-run OK"

# first run
# echo "[*] Running first backup (one-shot)"
# systemctl start db-backup.service || true
# sleep 2
# journalctl -u db-backup.service -n 100 --no-pager || true
echo "[*] Running first clean (one-shot)"
systemctl start docker-clean.service || true
sleep 2
journalctl -u docker-clean.service -n 100 --no-pager || true
echo "[✓] Setup finished."
