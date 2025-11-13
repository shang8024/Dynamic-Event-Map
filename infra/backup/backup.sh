#!/bin/bash
set -e

# Configuration from environment variables
DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-eventsdb}"
DB_USER="${DB_USER:-user}"
DB_PASSWORD_FILE="${DB_PASSWORD_FILE:-/run/secrets/pg_password}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/backups}"
S3_BUCKET="${S3_BUCKET}"
S3_ENDPOINT="${S3_ENDPOINT}"
S3_ACCESS_KEY="${S3_ACCESS_KEY}"
S3_SECRET_KEY="${S3_SECRET_KEY}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Read password from secret file
if [ -f "$DB_PASSWORD_FILE" ]; then
    DB_PASSWORD=$(cat "$DB_PASSWORD_FILE")
else
    echo "Error: Password file not found at $DB_PASSWORD_FILE"
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Generate timestamp for backup filename
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILENAME="backup_${DB_NAME}_${TIMESTAMP}.dump"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_FILENAME"

echo "[$(date)] Starting database backup..."
echo "Database: $DB_HOST:$DB_PORT/$DB_NAME"
echo "Backup file: $BACKUP_FILENAME"

# Create PostgreSQL backup (custom format with built-in compression)
export PGPASSWORD="$DB_PASSWORD"
pg_dump -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --no-owner \
        --no-acl \
        -Fc \
        -f "$BACKUP_PATH"

if [ $? -eq 0 ]; then
    echo "[$(date)] Backup created successfully: $BACKUP_PATH"
    BACKUP_SIZE=$(du -h "$BACKUP_PATH" | cut -f1)
    echo "Backup size: $BACKUP_SIZE"
else
    echo "[$(date)] ERROR: Backup failed"
    exit 1
fi

# Upload to DigitalOcean Spaces
if [ -n "$S3_BUCKET" ] && [ -n "$S3_ENDPOINT" ] && [ -n "$S3_ACCESS_KEY" ] && [ -n "$S3_SECRET_KEY" ]; then
    echo "[$(date)] Uploading backup to DigitalOcean Spaces..."
    
    # Configure rclone for S3-compatible storage
    export RCLONE_CONFIG_SPACES_TYPE=s3
    export RCLONE_CONFIG_SPACES_PROVIDER=DigitalOcean
    export RCLONE_CONFIG_SPACES_ACCESS_KEY_ID="$S3_ACCESS_KEY"
    export RCLONE_CONFIG_SPACES_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
    export RCLONE_CONFIG_SPACES_ENDPOINT="https://$S3_ENDPOINT"
    export RCLONE_CONFIG_SPACES_ACL=private

    # Upload backup
    rclone copy "$BACKUP_PATH" "spaces:$S3_BUCKET/backups/" --progress
    
    if [ $? -eq 0 ]; then
        echo "[$(date)] Backup uploaded successfully to spaces:$S3_BUCKET/backups/$BACKUP_FILENAME"
    else
        echo "[$(date)] ERROR: Upload to Spaces failed"
        exit 1
    fi
    
    # Clean up old backups in Spaces (older than BACKUP_RETENTION_DAYS)
    echo "[$(date)] Cleaning up old backups (older than $BACKUP_RETENTION_DAYS days)..."
    
    # Delete files older than BACKUP_RETENTION_DAYS
    rclone delete "spaces:$S3_BUCKET/backups/" --min-age "${BACKUP_RETENTION_DAYS}d" --include "backup_*.dump"
    
    if [ $? -eq 0 ]; then
        echo "[$(date)] Old backups cleaned up successfully"
    else
        echo "[$(date)] WARNING: Failed to clean up old backups"
    fi
else
    missing_vars=""
    [ -z "$S3_BUCKET" ] && missing_vars="${missing_vars} S3_BUCKET"
    [ -z "$S3_ENDPOINT" ] && missing_vars="${missing_vars} S3_ENDPOINT"
    [ -z "$S3_ACCESS_KEY" ] && missing_vars="${missing_vars} S3_ACCESS_KEY"
    [ -z "$S3_SECRET_KEY" ] && missing_vars="${missing_vars} S3_SECRET_KEY"
    echo "[$(date)] WARNING: S3 configuration incomplete (missing:${missing_vars}), skipping upload to Spaces"
fi

# Clean up local backup file
rm -f "$BACKUP_PATH"

echo "[$(date)] Backup process completed successfully"
