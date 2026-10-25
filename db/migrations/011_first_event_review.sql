BEGIN;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_event_approved_at timestamptz;
-- Existing community publishers retain access; imported listings grant no trust.
UPDATE profiles p SET first_event_approved_at=existing.first_created
FROM (SELECT user_id,min(created_at) first_created FROM events WHERE source='internal' GROUP BY user_id) existing
WHERE p.id=existing.user_id AND p.first_event_approved_at IS NULL;

-- Unpublished content never enters the public events table or its realtime feed.
CREATE TABLE IF NOT EXISTS event_publication_requests (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id integer REFERENCES events(id) ON DELETE SET NULL,
  draft jsonb NOT NULL CHECK(jsonb_typeof(draft)='object'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewer_id integer REFERENCES profiles(id) ON DELETE SET NULL,
  review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CHECK(status<>'rejected' OR length(btrim(review_note))>0)
);
CREATE INDEX IF NOT EXISTS event_publications_owner_idx ON event_publication_requests(user_id,id DESC);
CREATE INDEX IF NOT EXISTS event_publications_pending_idx ON event_publication_requests(id DESC) WHERE status='pending';
ALTER TABLE in_app_notifications ADD COLUMN IF NOT EXISTS publication_id bigint REFERENCES event_publication_requests(id) ON DELETE SET NULL;
ALTER TABLE in_app_notifications DROP CONSTRAINT IF EXISTS in_app_notifications_kind_check;
ALTER TABLE in_app_notifications ADD CONSTRAINT in_app_notifications_kind_check CHECK(kind IN (
  'comment','event_updated','event_cancelled','ingest_alert','suggestion_submitted','suggestion_approved','suggestion_rejected',
  'publication_submitted','publication_approved','publication_rejected'
));
COMMIT;
