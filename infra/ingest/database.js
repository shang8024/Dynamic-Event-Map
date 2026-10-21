import { FIELDS, PROVIDER } from './normalize.js';

const types = { starts_at: 'timestamptz', ends_at: 'timestamptz', latitude: 'double precision', longitude: 'double precision' };
const assignments = FIELDS.map(field => `${field} = CASE WHEN NOT (COALESCE(e.data->'editor_overrides','[]'::jsonb) ? '${field}') AND e.${field} IS NOT DISTINCT FROM (e.data->'import_snapshot'->>'${field}')::${types[field] || 'text'} THEN EXCLUDED.${field} ELSE e.${field} END`).join(',\n');
const upsert = `INSERT INTO events AS e (user_id, source, ref_id, ${FIELDS.join(', ')}, data)
  VALUES ($1, 'external', $2, ${FIELDS.map((_, i) => `$${i+3}`).join(', ')}, $${FIELDS.length+3}::jsonb)
  ON CONFLICT (source, ref_id) DO UPDATE SET ${assignments},
    data = e.data || EXCLUDED.data, updated_at = now()
  WHERE e.data->'import_metadata'->>'provider' = '${PROVIDER}'
    AND e.data->'import_snapshot'->>'content_hash' IS DISTINCT FROM EXCLUDED.data->'import_snapshot'->>'content_hash'
  RETURNING (xmax = 0) AS inserted`;

export async function importEvents(client, snapshot) {
  const result = { inserted: 0, updated: 0, unchanged: 0 };
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('eventmap:toronto-ingest'))");
    const index = await client.query("SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ux_events_natural_all'");
    if (index.rowCount) throw new Error('Apply db/migrations/001_ingestion_identity.sql before importing');
    await client.query("INSERT INTO profiles (username, password_hash) VALUES ('toronto-open-data', NULL) ON CONFLICT (username) DO NOTHING");
    const owner = await client.query("SELECT id FROM profiles WHERE username = 'toronto-open-data' AND password_hash IS NULL AND email IS NULL AND google_id IS NULL");
    if (owner.rowCount !== 1) throw new Error('Importer service profile is not an unclaimable system profile');
    // Legacy identity migration must preserve bookmarks/comments, not silently
    // create a duplicate second set of events.
    const legacy = await client.query("SELECT 1 FROM events WHERE source='external' AND (data->'import_metadata'->>'provider') IS DISTINCT FROM $1 LIMIT 1", [PROVIDER]);
    if (legacy.rowCount) throw new Error('Legacy external events found; migrate identities and references before enabling this importer');
    for (const event of snapshot.events) {
      const response = await client.query(upsert, [owner.rows[0].id, event.ref_id, ...FIELDS.map(field => event[field]), JSON.stringify(event.data)]);
      if (!response.rowCount) result.unchanged++;
      else if (response.rows[0].inserted) result.inserted++;
      else result.updated++;
    }
    // Additive notification migration is optional for the core deployment.
    // Refresh occurrences even when event content is unchanged, so a successful
    // full snapshot renews its source-observation time and suppresses missing
    // starts. Failure rolls back the same transaction; absence never deletes.
    const occurrenceSchema = await client.query("SELECT to_regprocedure('refresh_toronto_occurrences(text[],timestamp with time zone)') AS installed");
    if (occurrenceSchema.rows[0].installed) {
      const timestamp = snapshot.provenance?.source_last_modified;
      if (!timestamp) throw new Error('Occurrence refresh requires the validated source timestamp');
      const observed = /(Z|[+-]\d\d:\d\d)$/.test(timestamp) ? timestamp : `${timestamp}Z`;
      await client.query('SELECT refresh_toronto_occurrences($1::text[],$2::timestamptz)', [snapshot.events.map(event => event.ref_id), observed]);
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
