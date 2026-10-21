import { createHash } from 'node:crypto';
import { PROVIDER } from './normalize.js';

export const IMPORT_FORMAT_VERSION = 3;
export function sourceRevision(metadata) {
  if (!metadata.resource_id || !metadata.source_last_modified || !metadata.source_url) return null;
  return createHash('sha256').update(JSON.stringify({
    id: metadata.resource_id, url: metadata.source_url, modified: metadata.source_last_modified,
    size: metadata.source_size ?? null, hash: metadata.source_hash || null,
  })).digest('hex');
}
export function canSkipDownload(state, metadata) {
  return Boolean(state && state.format_version === IMPORT_FORMAT_VERSION &&
    /^[a-f0-9]{64}$/.test(state.provenance?.sha256 || '') && state.provenance.bytes > 0 &&
    sourceRevision(metadata) === state.revision);
}
export async function readSourceState(client) {
  const { rows: [schema] } = await client.query("SELECT to_regclass('event_ingest_state') AS installed");
  if (!schema.installed) throw new Error('Apply db/migrations/005_ingest_maintenance.sql before importing');
  return (await client.query('SELECT * FROM event_ingest_state WHERE provider=$1', [PROVIDER])).rows[0];
}
export async function recordSuccessfulImport(client, snapshot) {
  const revision = sourceRevision(snapshot.provenance);
  // Reviewed local manifests can omit resource metadata; such imports never
  // establish a reusable remote checkpoint.
  if (!revision) return;
  await client.query(`INSERT INTO event_ingest_state(provider,resource_id,revision,format_version,provenance,
      imported_at,checked_at,check_status,observed_revision) VALUES($1,$2,$3,$4,$5::jsonb,$6,$6,'current',$3)
    ON CONFLICT(provider) DO UPDATE SET resource_id=EXCLUDED.resource_id,revision=EXCLUDED.revision,
      format_version=EXCLUDED.format_version,provenance=EXCLUDED.provenance,imported_at=EXCLUDED.imported_at,
      checked_at=EXCLUDED.checked_at,check_status='current',observed_revision=EXCLUDED.observed_revision`,
  [PROVIDER,snapshot.provenance.resource_id,revision,IMPORT_FORMAT_VERSION,JSON.stringify(snapshot.provenance),snapshot.as_of]);
}
export async function confirmSourceCheck(client, metadata, checkedAt, { requireMatch = false } = {}) {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('eventmap:toronto-ingest'))");
    const state = await readSourceState(client);
    if (!state) throw new Error('A verified full import is required before metadata-only maintenance');
    const unchanged = canSkipDownload(state, metadata);
    if (requireMatch && !unchanged) throw new Error('Import checkpoint changed concurrently; retry the import');
    await client.query(`UPDATE event_ingest_state SET checked_at=$2,check_status=$3,observed_revision=$4 WHERE provider=$1`,
      [PROVIDER,checkedAt,unchanged?'current':'changed',sourceRevision(metadata)]);
    // A changed feed cannot renew old reminders. The next verified full import
    // will rebuild the schedule; a check never asserts a cancellation.
    await client.query(`UPDATE event_occurrences o SET source_observed_at=$2,updated_at=now()
      FROM events e WHERE o.event_id=e.id AND e.source='external'
        AND e.data->'import_metadata'->>'provider'=$1 AND e.archived_at IS NULL`,
    [PROVIDER,unchanged?checkedAt:null]);
    await client.query('COMMIT');
    return { status: unchanged?'unchanged':'source_changed', downloaded: false, last_imported_at: state.imported_at };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
export async function cleanupExpiredEvents(client, cutoff) {
  return (await client.query('SELECT * FROM cleanup_expired_events($1::timestamptz)', [cutoff])).rows[0];
}
