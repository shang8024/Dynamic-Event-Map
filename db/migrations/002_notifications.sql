-- Additive migration. Apply after 001 with psql -v ON_ERROR_STOP=1.
-- No mail is enabled by this migration; all consent defaults are false.
BEGIN;
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id integer PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  reminders_enabled boolean NOT NULL DEFAULT false,
  marketing_enabled boolean NOT NULL DEFAULT false,
  personalization_enabled boolean NOT NULL DEFAULT false,
  reminder_lead_hours integer NOT NULL DEFAULT 24 CHECK (reminder_lead_hours IN (1,24)),
  timezone text NOT NULL DEFAULT 'America/Toronto' CHECK (timezone = 'America/Toronto'),
  delivery_email text,
  verified_uid text,
  consent_version text NOT NULL DEFAULT '2026-10-21',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS consent_events (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('reminders','marketing','personalization')),
  enabled boolean NOT NULL,
  source text NOT NULL CHECK (source IN ('settings','signed_unsubscribe')),
  policy_version text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_events_user_idx ON consent_events(user_id,recorded_at DESC);
CREATE TABLE IF NOT EXISTS event_occurrences (
  id bigserial PRIMARY KEY,
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'America/Toronto',
  status text NOT NULL CHECK (status IN ('scheduled','source_missing','needs_review')),
  source_revision text,
  source_observed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,source_key),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS event_occurrences_due_idx ON event_occurrences(starts_at) WHERE status='scheduled';
CREATE TABLE IF NOT EXISTS email_suppressions (
  email_hash char(64) PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('hard_bounce','complaint','manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_feedback_receipts (
  message_id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  occurrence_id bigint REFERENCES event_occurrences(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reminder','marketing')),
  delivery_key text NOT NULL UNIQUE,
  scheduled_start timestamptz,
  scheduled_for timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','dispatching','sent','cancelled','expired','uncertain','failed')),
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  error_code text,
  last_dry_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > scheduled_for)
);
CREATE INDEX IF NOT EXISTS notification_outbox_due_idx ON notification_outbox(available_at,scheduled_for) WHERE status='pending';

-- Called only after a complete, validated, non-empty official snapshot. Missing
-- occurrences are suppressed, never deleted or asserted to be cancellations.
CREATE OR REPLACE FUNCTION refresh_toronto_occurrences(accepted_refs text[], observed_at timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cardinality(accepted_refs) < 1 OR observed_at IS NULL THEN
    RAISE EXCEPTION 'A non-empty validated snapshot and source timestamp are required';
  END IF;
  UPDATE event_occurrences o SET status='source_missing',updated_at=now()
    FROM events e WHERE o.event_id=e.id AND e.source='external'
    AND e.data->'import_metadata'->>'provider'='toronto-open-data';
  INSERT INTO event_occurrences(event_id,source_key,starts_at,status,source_revision,source_observed_at)
  SELECT e.id,COALESCE(NULLIF(x->>'source_row_id',''),x->>'starts_at'),(x->>'starts_at')::timestamptz,
    CASE WHEN e.starts_at IS DISTINCT FROM (e.data->'import_snapshot'->>'starts_at')::timestamptz
           OR e.ends_at IS DISTINCT FROM (e.data->'import_snapshot'->>'ends_at')::timestamptz
           OR (x->>'starts_at')::timestamptz < e.starts_at
           OR (e.ends_at IS NOT NULL AND (x->>'starts_at')::timestamptz > e.ends_at)
           OR (x->>'starts_at')::timestamptz > observed_at + interval '366 days'
         THEN 'needs_review' ELSE 'scheduled' END,
    e.data->'import_snapshot'->>'content_hash',observed_at
  FROM events e CROSS JOIN LATERAL jsonb_array_elements(e.data->'occurrences') x
  WHERE e.source='external' AND e.ref_id=ANY(accepted_refs)
    AND e.data->'import_metadata'->>'provider'='toronto-open-data'
    AND x->>'starts_at' ~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
  ON CONFLICT(event_id,source_key) DO UPDATE SET starts_at=EXCLUDED.starts_at,
    status=EXCLUDED.status,source_revision=EXCLUDED.source_revision,
    source_observed_at=EXCLUDED.source_observed_at,updated_at=now();
END $$;

-- User-authored events have one explicitly supplied start; no range expansion.
CREATE OR REPLACE FUNCTION refresh_internal_occurrences() RETURNS void LANGUAGE sql AS $$
  UPDATE event_occurrences o SET status='source_missing',updated_at=now()
    FROM events e WHERE o.event_id=e.id AND e.source='internal';
  INSERT INTO event_occurrences(event_id,source_key,starts_at,ends_at,status,source_revision)
    SELECT id,'single',starts_at,ends_at,
      CASE WHEN ends_at IS NOT NULL AND ends_at < starts_at THEN 'needs_review' ELSE 'scheduled' END,
      updated_at::text FROM events WHERE source='internal' AND starts_at IS NOT NULL
      AND (ends_at IS NULL OR ends_at >= starts_at)
    ON CONFLICT(event_id,source_key) DO UPDATE SET starts_at=EXCLUDED.starts_at,
      ends_at=EXCLUDED.ends_at,status=EXCLUDED.status,source_revision=EXCLUDED.source_revision,updated_at=now();
$$;
-- Safe initial backfill uses each row's actual source timestamp, not now().
DO $$ DECLARE source_version record; BEGIN
  SELECT array_agg(ref_id) refs,
      min(((data->'import_metadata'->>'source_last_modified') || CASE
        WHEN data->'import_metadata'->>'source_last_modified' ~ '(Z|[+-]\d{2}:\d{2})$' THEN '' ELSE 'Z' END)::timestamptz) observed
    FROM events WHERE source='external' AND data->'import_metadata'->>'provider'='toronto-open-data'
      AND data->'import_metadata'->>'source_last_modified' IS NOT NULL
    INTO source_version;
  IF cardinality(source_version.refs)>0 THEN
    PERFORM refresh_toronto_occurrences(source_version.refs,source_version.observed);
  END IF;
  PERFORM refresh_internal_occurrences();
END $$;
COMMIT;
