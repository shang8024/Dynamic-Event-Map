BEGIN;
ALTER TABLE events ADD COLUMN IF NOT EXISTS comment_revision bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id integer REFERENCES events(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK(kind IN ('comment','event_updated','event_cancelled')),
  title text NOT NULL,
  message text NOT NULL,
  activity_key text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,activity_key)
);
CREATE INDEX IF NOT EXISTS in_app_user_notifications_idx ON in_app_notifications(user_id,id DESC);
CREATE TABLE IF NOT EXISTS realtime_outbox (
  id bigserial PRIMARY KEY,
  room text,
  event text NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS realtime_outbox_pending_idx ON realtime_outbox(id) WHERE published_at IS NULL;
CREATE OR REPLACE FUNCTION enqueue_in_app_notifications(target integer, actor integer, notification_kind text, activity text, heading text, body text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE recipient record;
BEGIN
  FOR recipient IN
    INSERT INTO in_app_notifications(user_id,event_id,kind,title,message,activity_key)
    SELECT b.user_id,target,notification_kind,heading,body,activity FROM bookmarks b
    WHERE b.event_id=target AND b.user_id IS DISTINCT FROM actor
    ON CONFLICT(user_id,activity_key) DO NOTHING RETURNING user_id,id
  LOOP
    INSERT INTO realtime_outbox(room,event,payload) VALUES('user_'||recipient.user_id,'notification:changed',jsonb_build_object('id',recipient.id));
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION event_activity_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; changed boolean;
BEGIN
  changed := ROW(NEW.starts_at,NEW.ends_at,NEW.location_address,NEW.latitude,NEW.longitude,NEW.status)
    IS DISTINCT FROM ROW(OLD.starts_at,OLD.ends_at,OLD.location_address,OLD.latitude,OLD.longitude,OLD.status);
  IF changed OR ROW(NEW.title,NEW.description,NEW.category,NEW.data) IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.category,OLD.data) THEN
    INSERT INTO realtime_outbox(event,payload) VALUES('event:updated',to_jsonb(NEW));
  END IF;
  IF changed THEN
    actor := NULLIF(current_setting('eventmap.actor_id',true),'')::integer;
    PERFORM enqueue_in_app_notifications(NEW.id,actor,CASE WHEN NEW.status='cancelled' THEN 'event_cancelled' ELSE 'event_updated' END,
      'event:'||NEW.id||':'||nextval('realtime_outbox_id_seq'),NEW.title,
      CASE WHEN NEW.status='cancelled' THEN 'This saved event has been cancelled.' ELSE 'The time or location of this saved event has changed.' END);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS event_activity_changed ON events;
CREATE TRIGGER event_activity_changed AFTER UPDATE ON events FOR EACH ROW EXECUTE FUNCTION event_activity_changed();
CREATE OR REPLACE FUNCTION comment_activity_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target integer; revision bigint; heading text; actor integer;
BEGIN
  IF TG_OP='INSERT' THEN target:=NEW.event_id; actor:=NEW.user_id; ELSE target:=OLD.event_id; END IF;
  UPDATE events SET comment_revision=comment_revision+1 WHERE id=target RETURNING comment_revision,title INTO revision,heading;
  IF revision IS NOT NULL THEN
    INSERT INTO realtime_outbox(room,event,payload) VALUES('event_'||target,'comments:changed',jsonb_build_object('eventId',target,'revision',revision));
    IF TG_OP='INSERT' THEN
      PERFORM enqueue_in_app_notifications(target,actor,'comment','comment:'||NEW.id,heading,'A new comment was added to your saved event.');
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS comment_activity_changed ON comments;
CREATE TRIGGER comment_activity_changed AFTER INSERT OR DELETE ON comments FOR EACH ROW EXECUTE FUNCTION comment_activity_changed();
COMMIT;
