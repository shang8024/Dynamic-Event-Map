#!/bin/sh
echo "Waiting for Redis at redis:6379..."
max_retries=30
retry_count=0
until nc -z redis 6379 >/dev/null 2>&1; do
  retry_count=$((retry_count + 1))
  if [ $retry_count -ge $max_retries ]; then
    echo "Redis not available after $max_retries attempts"
    exit 1
  fi
  echo "Redis unavailable - attempt $retry_count/$max_retries"
  sleep 2
done
echo "Redis is ready - starting API"
exec node index.js
