BEGIN;
ALTER TABLE events ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS events_expiry_idx ON events(ends_at) WHERE ends_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS event_ingest_state (
  provider text PRIMARY KEY,
  resource_id text NOT NULL,
  revision char(64) NOT NULL,
  format_version integer NOT NULL,
  provenance jsonb NOT NULL,
  imported_at timestamptz NOT NULL,
  checked_at timestamptz NOT NULL,
  check_status text NOT NULL CHECK (check_status IN ('current','changed')),
  observed_revision char(64) NOT NULL
);

-- Archival is maintenance, not a location change or cancellation notification.
CREATE OR REPLACE FUNCTION event_activity_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; changed boolean;
BEGIN
  IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    INSERT INTO realtime_outbox(event,payload) VALUES('event:deleted',jsonb_build_object('id',NEW.id));
    RETURN NEW;
  END IF;
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

-- Only an explicit final end can expire a series. A future/ongoing scheduled
-- occurrence blocks cleanup even when the series end is inconsistent.
CREATE OR REPLACE FUNCTION cleanup_expired_events(cutoff timestamptz)
RETURNS TABLE(deleted integer, archived integer) LANGUAGE plpgsql AS $$
DECLARE item record; deleted_count integer := 0; archived_count integer := 0;
BEGIN
  IF cutoff IS NULL OR cutoff > now() THEN RAISE EXCEPTION 'Cleanup requires a non-future cutoff'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('eventmap:toronto-ingest'));
  FOR item IN SELECT e.id,e.archived_at FROM events e
    WHERE e.ends_at <= cutoff AND NOT EXISTS (
      SELECT 1 FROM event_occurrences o WHERE o.event_id=e.id AND o.status='scheduled'
        AND (o.starts_at>cutoff OR o.ends_at>cutoff))
    ORDER BY e.id FOR UPDATE OF e
  LOOP
    IF NOT EXISTS (SELECT 1 FROM bookmarks WHERE event_id=item.id)
       AND NOT EXISTS (SELECT 1 FROM comments WHERE event_id=item.id) THEN
      DELETE FROM events WHERE id=item.id;
      INSERT INTO realtime_outbox(event,payload) VALUES('event:deleted',jsonb_build_object('id',item.id));
      deleted_count := deleted_count+1;
    ELSIF item.archived_at IS NULL THEN
      -- Keep a small history row for saved events/discussions, rather than
      -- cascading away users' bookmarks and comments. No photo links or raw feed.
      UPDATE events SET archived_at=cutoff,description=NULL,latitude=NULL,longitude=NULL,
        data=jsonb_strip_nulls(jsonb_build_object(
          'import_metadata',CASE WHEN source='external' THEN jsonb_build_object(
            'provider',data->'import_metadata'->>'provider','source_id',data->'import_metadata'->>'source_id') END,
          'editor_overrides',data->'editor_overrides')),
        version=version+1,updated_at=now() WHERE id=item.id;
      DELETE FROM event_occurrences WHERE event_id=item.id;
      archived_count := archived_count+1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT deleted_count,archived_count;
END $$;
COMMIT;
