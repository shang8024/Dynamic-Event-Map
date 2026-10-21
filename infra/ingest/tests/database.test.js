import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import fs from 'node:fs/promises';
import { normalizeFeed } from '../normalize.js';
import { importEvents } from '../database.js';

test('PostgreSQL: idempotence, manual edits, user ownership and rollback', { skip: process.env.INGEST_DB_TEST !== '1' }, async () => {
  // Explicitly enabled local integration test; never touches the public schema.
  assert.equal(process.env.PGHOST, '127.0.0.1');
  assert.equal(process.env.PGPORT,process.env.INGEST_PG16_TEST==='1'?'55433':'55432');
  const client = new pg.Client();
  await client.connect();
  const schema = `ingest_test_${process.pid}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(await fs.readFile(new URL('../../../db/init.sql', import.meta.url), 'utf8'));
    await client.query('DROP INDEX ux_events_natural_all');
    const source = { id: 'row-1', submission_id: 's1', event_name: 'Festival', event_status: 'Approved', event_startdate: '2026-10-25T10:00:00-04:00', event_expirydate: '2026-10-25T17:00:00-04:00', calendar_date: '2026-10-25T10:00:00-04:00', event_description: 'Original description' };
    const snapshot = (raw = source) => normalizeFeed({ value: [raw] }, { asOf: '2026-10-21T00:00:00Z', provenance: {} });
    assert.deepEqual(await importEvents(client, snapshot()), { inserted: 1, updated: 0, unchanged: 0 });
    assert.deepEqual(await importEvents(client, snapshot()), { inserted: 0, updated: 0, unchanged: 1 });
    const { rows: [original] } = await client.query("SELECT * FROM events WHERE ref_id='toronto:s1'");
    await client.query("UPDATE events SET title='Curated title' WHERE id=$1", [original.id]);
    await client.query("UPDATE events SET data=data||$2::jsonb WHERE id=$1",[original.id,JSON.stringify({image:{url:'https://images.unsplash.com/curated',credit:'Editor'},image_hidden:true,editor_overrides:['title']})]);
    await client.query("INSERT INTO events(user_id,title,source) VALUES (1,'User event','internal')");
    const changed = snapshot({ ...source, event_name: 'Upstream title', event_description: 'Changed description' });
    assert.deepEqual(await importEvents(client, changed), { inserted: 0, updated: 1, unchanged: 0 });
    const { rows: [updated] } = await client.query("SELECT * FROM events WHERE ref_id='toronto:s1'");
    assert.equal(updated.id, original.id);
    assert.equal(updated.title, 'Curated title');
    assert.equal(updated.description, 'Changed description');
    assert.equal(updated.user_id,original.user_id);
    assert.equal(updated.data.image.url,'https://images.unsplash.com/curated');
    assert.equal(updated.data.image_hidden,true);
    assert.deepEqual(updated.data.editor_overrides,['title']);
    assert.equal((await client.query("SELECT title FROM events WHERE source='internal'")).rows[0].title, 'User event');
    const broken = { events: [{ ...changed.events[0], ref_id: 'toronto:rollback-1' }, { ...changed.events[0], ref_id: 'toronto:rollback-2', title: 'x'.repeat(256) }] };
    await assert.rejects(() => importEvents(client, broken), /too long/);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM events WHERE ref_id LIKE 'toronto:rollback%'")).rows[0].n, 0);
  } finally {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
