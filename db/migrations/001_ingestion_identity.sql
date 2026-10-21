-- Apply once with psql -v ON_ERROR_STOP=1, after a verified backup.
-- Source identity is UNIQUE(source, ref_id), already defined by db/init.sql.
-- The old global natural-key index conflates distinct events and prevents
-- preserving independently authored events with the same title/time/location.
BEGIN;
DROP INDEX IF EXISTS ux_events_natural_all;
COMMIT;
