FROM postgres:16-alpine

# Use signed Alpine packages, including architecture-matched rclone.
RUN apk add --no-cache bash ca-certificates rclone
COPY common.sh backup.sh restore.sh list.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/common.sh /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/list.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
