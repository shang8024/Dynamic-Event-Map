#!/usr/bin/env bash
# Shared by the backup image's entrypoints. Never enable shell tracing here.
fail() { echo "ERROR: $*" >&2; exit 1; }

read_secret() {
  local variable="$1" fallback_file="$2" file_variable="${1}_FILE" value
  local secret_file="${!file_variable:-$fallback_file}"
  [[ -r "$secret_file" ]] || fail "Required secret file is unreadable: $secret_file"
  value=$(cat "$secret_file")
  [[ -n "$value" ]] || fail "Required secret file is empty: $secret_file"
  printf -v "$variable" '%s' "$value"
  export "$variable"
}

configure_database() {
  export PGHOST="${DB_HOST:-db}" PGPORT="${DB_PORT:-5432}"
  export PGDATABASE="${DB_NAME:-eventsdb}" PGUSER="${DB_USER:-user}"
  export PGCONNECT_TIMEOUT=15
  DB_NAME="$PGDATABASE"
  [[ "$DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$ ]] || fail "Invalid database name"
  read_secret DB_PASSWORD /run/secrets/pg_password
  export PGPASSWORD="$DB_PASSWORD"
  unset DB_PASSWORD
}

configure_storage() {
  S3_PROVIDER="${S3_PROVIDER:-AWS}"
  S3_REGION="${S3_REGION:-ca-central-1}"
  S3_ENDPOINT="${S3_ENDPOINT:-}"
  S3_PREFIX="${S3_PREFIX:-backups}"
  [[ "${S3_BUCKET:-}" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "Set a valid S3_BUCKET"
  [[ "$S3_PREFIX" =~ ^[a-zA-Z0-9][a-zA-Z0-9/_-]*$ ]] || fail "Invalid S3_PREFIX"
  [[ "$S3_REGION" =~ ^[a-z0-9-]+$ ]] || fail "Invalid S3_REGION"
  case "$S3_PROVIDER" in
    AWS) ;;
    DigitalOcean) [[ -n "$S3_ENDPOINT" ]] || fail "DigitalOcean requires S3_ENDPOINT" ;;
    *) fail "S3_PROVIDER must be AWS or DigitalOcean" ;;
  esac
  if [[ -n "$S3_ENDPOINT" ]]; then
    # Accept the historical hostname-only form; never prepend https twice.
    [[ "$S3_ENDPOINT" == *://* ]] || S3_ENDPOINT="https://$S3_ENDPOINT"
    case "$S3_ENDPOINT" in
      https://*) ;;
      http://*) [[ "${S3_ALLOW_HTTP:-false}" == true ]] || fail "S3 requires HTTPS" ;;
      *) fail "Unsupported S3 endpoint scheme" ;;
    esac
  fi
  read_secret S3_ACCESS_KEY /run/secrets/s3_access_key
  read_secret S3_SECRET_KEY /run/secrets/s3_secret_key
  export RCLONE_CONFIG=/dev/null
  export RCLONE_CONFIG_BACKUP_TYPE=s3
  export RCLONE_CONFIG_BACKUP_PROVIDER="$S3_PROVIDER"
  export RCLONE_CONFIG_BACKUP_REGION="$S3_REGION"
  export RCLONE_CONFIG_BACKUP_ENDPOINT="$S3_ENDPOINT"
  export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID="$S3_ACCESS_KEY"
  export RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
  export RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true
  # ACLs remain unset for AWS Bucket owner enforced; bucket public access is blocked.
  export RCLONE_CONFIG_BACKUP_ACL=""
  export RCLONE_CONFIG_BACKUP_SERVER_SIDE_ENCRYPTION=""
  if [[ "$S3_PROVIDER" == AWS ]]; then
    export RCLONE_CONFIG_BACKUP_SERVER_SIDE_ENCRYPTION=AES256
  fi
  unset S3_ACCESS_KEY S3_SECRET_KEY
}
