BEGIN;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member'
  CHECK (role IN ('member','admin'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scheduled'
  CHECK (status IN ('scheduled','cancelled'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS event_edit_history (
  id bigserial PRIMARY KEY,
  event_id integer REFERENCES events(id) ON DELETE SET NULL,
  actor_id integer REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
