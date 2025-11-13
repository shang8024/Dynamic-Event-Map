FROM postgres:16-alpine

# Install rclone for DigitalOcean Spaces backup (S3-compatible)
RUN apk add --no-cache \
    bash \
    curl \
    ca-certificates \
    unzip \
    && curl -O https://downloads.rclone.org/rclone-current-linux-amd64.zip \
    && unzip rclone-current-linux-amd64.zip \
    && cp rclone-*-linux-amd64/rclone /usr/local/bin/ \
    && chmod +x /usr/local/bin/rclone \
    && rm -rf rclone-* \
    && apk del curl

# Copy backup scripts
COPY backup.sh /usr/local/bin/backup.sh
COPY restore.sh /usr/local/bin/restore.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh

ENTRYPOINT ["/usr/local/bin/backup.sh"]
