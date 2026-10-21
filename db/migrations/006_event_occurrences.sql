BEGIN;
-- Refresh one author/admin-managed schedule atomically with its parent event.
-- Removed slots remain source_missing so queued reminders are invalidated.
CREATE OR REPLACE FUNCTION refresh_event_occurrences(target integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item events%ROWTYPE;
BEGIN
  SELECT * INTO item FROM events WHERE id=target;
  IF NOT FOUND OR item.archived_at IS NOT NULL THEN RETURN; END IF;
  IF item.source<>'internal' AND item.data->>'schedule_origin' IS DISTINCT FROM 'manual' THEN RETURN; END IF;
  UPDATE event_occurrences SET status='source_missing',updated_at=now() WHERE event_id=target;
  IF item.data->>'schedule_origin'='manual' THEN
    INSERT INTO event_occurrences(event_id,source_key,starts_at,ends_at,status,source_revision)
      SELECT target,'manual:'||(slot->>'key'),(slot->>'starts_at')::timestamptz,
        (slot->>'ends_at')::timestamptz,'scheduled',item.version::text
      FROM jsonb_array_elements(item.data->'occurrences') slot
      ON CONFLICT(event_id,source_key) DO UPDATE SET starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,
        status=EXCLUDED.status,source_revision=EXCLUDED.source_revision,updated_at=now();
  ELSIF item.starts_at IS NOT NULL THEN
    INSERT INTO event_occurrences(event_id,source_key,starts_at,ends_at,status,source_revision)
      VALUES(target,'single',item.starts_at,item.ends_at,'scheduled',item.version::text)
      ON CONFLICT(event_id,source_key) DO UPDATE SET starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,
        status=EXCLUDED.status,source_revision=EXCLUDED.source_revision,updated_at=now();
  END IF;
END $$;
CREATE OR REPLACE FUNCTION refresh_internal_occurrences() RETURNS void LANGUAGE plpgsql AS $$
DECLARE target integer;
BEGIN
  FOR target IN SELECT id FROM events WHERE archived_at IS NULL
    AND (source='internal' OR data->>'schedule_origin'='manual')
  LOOP PERFORM refresh_event_occurrences(target); END LOOP;
END $$;
CREATE OR REPLACE FUNCTION refresh_toronto_occurrences(accepted_refs text[], observed_at timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cardinality(accepted_refs)<1 OR observed_at IS NULL THEN RAISE EXCEPTION 'A non-empty validated snapshot and source timestamp are required'; END IF;
  UPDATE event_occurrences o SET status='source_missing',updated_at=now() FROM events e
    WHERE o.event_id=e.id AND e.source='external' AND e.data->'import_metadata'->>'provider'='toronto-open-data'
      AND e.data->>'schedule_origin' IS DISTINCT FROM 'manual';
  INSERT INTO event_occurrences(event_id,source_key,starts_at,ends_at,status,source_revision,source_observed_at)
    SELECT e.id,COALESCE(NULLIF(slot->>'source_row_id',''),slot->>'starts_at'),
      (slot->>'starts_at')::timestamptz,(slot->>'ends_at')::timestamptz,
      CASE WHEN e.starts_at IS DISTINCT FROM (e.data->'import_snapshot'->>'starts_at')::timestamptz
        OR e.ends_at IS DISTINCT FROM (e.data->'import_snapshot'->>'ends_at')::timestamptz
        OR (slot->>'starts_at')::timestamptz<e.starts_at
        OR (e.ends_at IS NOT NULL AND (slot->>'starts_at')::timestamptz>e.ends_at)
        OR (slot->>'starts_at')::timestamptz>observed_at+interval '366 days'
      THEN 'needs_review' ELSE 'scheduled' END,
      e.data->'import_snapshot'->>'content_hash',observed_at
    FROM events e CROSS JOIN LATERAL jsonb_array_elements(e.data->'occurrences') slot
    WHERE e.ref_id=ANY(accepted_refs) AND e.source='external' AND e.archived_at IS NULL
      AND e.data->'import_metadata'->>'provider'='toronto-open-data'
      AND e.data->>'schedule_origin' IS DISTINCT FROM 'manual'
    ON CONFLICT(event_id,source_key) DO UPDATE SET starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,
      status=EXCLUDED.status,source_revision=EXCLUDED.source_revision,source_observed_at=EXCLUDED.source_observed_at,updated_at=now();
END $$;
-- A middle occurrence can change while the series' first/last bounds stay the
-- same. Followers still need a durable schedule-change notification.
CREATE OR REPLACE FUNCTION event_activity_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; changed boolean;
BEGIN
  IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    INSERT INTO realtime_outbox(event,payload) VALUES('event:deleted',jsonb_build_object('id',NEW.id));RETURN NEW;
  END IF;
  changed := ROW(NEW.starts_at,NEW.ends_at,NEW.location_address,NEW.latitude,NEW.longitude,NEW.status)
    IS DISTINCT FROM ROW(OLD.starts_at,OLD.ends_at,OLD.location_address,OLD.latitude,OLD.longitude,OLD.status)
    OR NEW.data->'occurrences' IS DISTINCT FROM OLD.data->'occurrences';
  IF changed OR ROW(NEW.title,NEW.description,NEW.category,NEW.data) IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.category,OLD.data) THEN
    INSERT INTO realtime_outbox(event,payload) VALUES('event:updated',to_jsonb(NEW));
  END IF;
  IF changed THEN
    actor := NULLIF(current_setting('eventmap.actor_id',true),'')::integer;
    PERFORM enqueue_in_app_notifications(NEW.id,actor,CASE WHEN NEW.status='cancelled' THEN 'event_cancelled' ELSE 'event_updated' END,
      'event:'||NEW.id||':'||nextval('realtime_outbox_id_seq'),NEW.title,
      CASE WHEN NEW.status='cancelled' THEN 'This saved event has been cancelled.' ELSE 'The schedule or location of this saved event has changed.' END);
  END IF;
  RETURN NEW;
END $$;
COMMIT;
