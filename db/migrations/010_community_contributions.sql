BEGIN;
CREATE TABLE IF NOT EXISTS event_contributors (
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id,user_id)
);
INSERT INTO event_contributors(event_id,user_id)
  SELECT id,user_id FROM events WHERE source='internal' AND data->'submission'->>'role'='reporter'
  ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION record_original_reporter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source='internal' AND NEW.data->'submission'->>'role'='reporter' THEN
    INSERT INTO event_contributors(event_id,user_id) VALUES(NEW.id,NEW.user_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS event_original_reporter ON events;
CREATE TRIGGER event_original_reporter AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION record_original_reporter();

CREATE TABLE IF NOT EXISTS event_change_requests (
  id bigserial PRIMARY KEY,
  event_id integer REFERENCES events(id) ON DELETE SET NULL,
  submitter_id integer NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_title varchar(255) NOT NULL,
  base_version bigint NOT NULL,
  changes jsonb NOT NULL CHECK(jsonb_typeof(changes)='object'),
  original_values jsonb NOT NULL CHECK(jsonb_typeof(original_values)='object'),
  explanation text NOT NULL CHECK(length(explanation) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewer_id integer REFERENCES profiles(id) ON DELETE SET NULL,
  review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_event_request_per_user ON event_change_requests(event_id,submitter_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS event_requests_submitter_idx ON event_change_requests(submitter_id,id DESC);
CREATE INDEX IF NOT EXISTS event_requests_pending_idx ON event_change_requests(id DESC) WHERE status='pending';
ALTER TABLE in_app_notifications DROP CONSTRAINT IF EXISTS in_app_notifications_kind_check;
ALTER TABLE in_app_notifications ADD CONSTRAINT in_app_notifications_kind_check
  CHECK(kind IN ('comment','event_updated','event_cancelled','suggestion_submitted','suggestion_approved','suggestion_rejected'));
ALTER TABLE in_app_notifications ADD COLUMN IF NOT EXISTS suggestion_id bigint REFERENCES event_change_requests(id) ON DELETE SET NULL;
COMMIT;
