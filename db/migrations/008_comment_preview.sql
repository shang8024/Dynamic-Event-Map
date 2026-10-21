BEGIN;
CREATE INDEX IF NOT EXISTS comments_event_recent_idx ON comments(event_id,created_at DESC,id DESC);

-- Every change that can affect a comment preview advances the DB revision.
-- This includes direct SQL edits, not only writes through one API instance.
CREATE OR REPLACE FUNCTION comment_activity_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE targets integer[]; target integer; revision bigint; heading text; actor integer;
BEGIN
  IF TG_OP='INSERT' THEN
    targets:=ARRAY[NEW.event_id]; actor:=NEW.user_id;
  ELSIF TG_OP='DELETE' THEN
    targets:=ARRAY[OLD.event_id];
  ELSE
    IF ROW(NEW.id,NEW.event_id,NEW.user_id,NEW.text,NEW.created_at)
      IS NOT DISTINCT FROM ROW(OLD.id,OLD.event_id,OLD.user_id,OLD.text,OLD.created_at) THEN RETURN NULL; END IF;
    targets:=ARRAY[OLD.event_id,NEW.event_id];
  END IF;
  FOR target IN SELECT DISTINCT event_id FROM unnest(targets) AS affected(event_id) ORDER BY event_id LOOP
    UPDATE events SET comment_revision=comment_revision+1 WHERE id=target RETURNING comment_revision,title INTO revision,heading;
    IF revision IS NOT NULL THEN
      INSERT INTO realtime_outbox(room,event,payload) VALUES('event_'||target,'comments:changed',jsonb_build_object('eventId',target,'revision',revision));
      IF TG_OP='INSERT' THEN
        PERFORM enqueue_in_app_notifications(target,actor,'comment','comment:'||NEW.id,heading,'A new comment was added to your saved event.');
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS comment_activity_changed ON comments;
CREATE TRIGGER comment_activity_changed AFTER INSERT OR UPDATE OR DELETE ON comments FOR EACH ROW EXECUTE FUNCTION comment_activity_changed();
COMMIT;
