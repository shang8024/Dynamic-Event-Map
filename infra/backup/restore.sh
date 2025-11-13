#!/bin/bash
set -e

# Configuration from environment variables
DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-eventsdb}"
DB_USER="${DB_USER:-user}"
DB_PASSWORD_FILE="${DB_PASSWORD_FILE:-/run/secrets/pg_password}"
BACKUP_FILE="${BACKUP_FILE}"
S3_BUCKET="${S3_BUCKET}"
S3_ENDPOINT="${S3_ENDPOINT}"
S3_ACCESS_KEY="${S3_ACCESS_KEY}"
S3_SECRET_KEY="${S3_SECRET_KEY}"

# Read password from secret file
if [ -f "$DB_PASSWORD_FILE" ]; then
    DB_PASSWORD=$(cat "$DB_PASSWORD_FILE")
else
    echo "Error: Password file not found at $DB_PASSWORD_FILE"
    exit 1
fi

if [ -z "$BACKUP_FILE" ]; then
    echo "Error: BACKUP_FILE environment variable is required"
    echo "Usage: docker run -e BACKUP_FILE=backup_eventsdb_20231110_120000.dump ..."
    exit 1
fi

RESTORE_DIR="/tmp/restore"
mkdir -p "$RESTORE_DIR"

echo "[$(date)] Starting database restore..."
echo "Database: $DB_HOST:$DB_PORT/$DB_NAME"
echo "Backup file: $BACKUP_FILE"

# Download from DigitalOcean Spaces if not a local file
if [[ "$BACKUP_FILE" == spaces://* ]] || [[ "$BACKUP_FILE" == s3://* ]] || [ ! -f "$BACKUP_FILE" ]; then
    if [ -n "$S3_BUCKET" ] && [ -n "$S3_ENDPOINT" ] && [ -n "$S3_ACCESS_KEY" ] && [ -n "$S3_SECRET_KEY" ]; then
        echo "[$(date)] Downloading backup from DigitalOcean Spaces..."
        
        # Configure rclone for S3-compatible storage
        export RCLONE_CONFIG_SPACES_TYPE=s3
        export RCLONE_CONFIG_SPACES_PROVIDER=DigitalOcean
        export RCLONE_CONFIG_SPACES_ACCESS_KEY_ID="$S3_ACCESS_KEY"
        export RCLONE_CONFIG_SPACES_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
        export RCLONE_CONFIG_SPACES_ENDPOINT="https://$S3_ENDPOINT"
        export RCLONE_CONFIG_SPACES_ACL=private

        # Determine the remote path
        if [[ "$BACKUP_FILE" == spaces://* ]] || [[ "$BACKUP_FILE" == s3://* ]]; then
            # Remove protocol prefix
            BACKUP_FILE="${BACKUP_FILE#spaces://}"
            BACKUP_FILE="${BACKUP_FILE#s3://}"
            REMOTE_PATH="spaces:$BACKUP_FILE"
        else
            REMOTE_PATH="spaces:$S3_BUCKET/backups/$BACKUP_FILE"
        fi
        
        LOCAL_BACKUP="$RESTORE_DIR/$(basename "$BACKUP_FILE")"
        
        # Download backup
        rclone copy "$REMOTE_PATH" "$RESTORE_DIR/" --progress
        
        if [ $? -eq 0 ] && [ -f "$LOCAL_BACKUP" ]; then
            echo "[$(date)] Backup downloaded successfully"
            BACKUP_FILE="$LOCAL_BACKUP"
        else
            echo "[$(date)] ERROR: Failed to download backup from Spaces"
            exit 1
        fi
    else
        echo "ERROR: S3 configuration incomplete, cannot download backup"
        exit 1
    fi
fi

# Restore database
echo "[$(date)] Restoring database from $BACKUP_FILE..."
export PGPASSWORD="$DB_PASSWORD"

# Restore using pg_restore (custom format)
# --clean: Drop database objects before recreating
# --if-exists: Use IF EXISTS when dropping objects (prevents errors if object doesn't exist)
# --no-owner: Skip ownership commands
# --no-acl: Skip access privileges commands
pg_restore -h "$DB_HOST" \
           -p "$DB_PORT" \
           -U "$DB_USER" \
           -d "$DB_NAME" \
           --clean \
           --if-exists \
           --no-owner \
           --no-acl \
           "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "[$(date)] Database restored successfully"
    
    # Clear Redis cache after restore
    echo "[$(date)] Clearing Redis cache..."
    REDIS_HOST="${REDIS_HOST:-redis}"
    REDIS_PORT="${REDIS_PORT:-6379}"
    REDIS_PASSWORD_FILE="${REDIS_PASSWORD_FILE:-/run/secrets/redis_password}"
    
    if [ -f "$REDIS_PASSWORD_FILE" ]; then
        REDIS_PASSWORD=$(cat "$REDIS_PASSWORD_FILE")
        if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" FLUSHALL; then
            echo "[$(date)] Redis cache cleared successfully"
        else
            echo "[$(date)] WARNING: Failed to clear Redis cache, but database was restored"
        fi
    else
        echo "[$(date)] WARNING: Redis password file not found, skipping cache clear"
    fi
else
    echo "[$(date)] ERROR: Database restore failed"
    exit 1
fi

# Clean up
rm -rf "$RESTORE_DIR"

echo "[$(date)] Restore process completed successfully"
