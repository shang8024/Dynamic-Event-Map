BEGIN;
ALTER TABLE in_app_notifications DROP CONSTRAINT IF EXISTS in_app_notifications_kind_check;
ALTER TABLE in_app_notifications ADD CONSTRAINT in_app_notifications_kind_check
  CHECK(kind IN ('comment','event_updated','event_cancelled','ingest_alert'));
CREATE TABLE IF NOT EXISTS ingest_alerts (
  id bigserial PRIMARY KEY,
  dedup_key char(64) UNIQUE NOT NULL,
  code text NOT NULL,
  details jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  repetitions integer NOT NULL DEFAULT 1
);
COMMIT;
