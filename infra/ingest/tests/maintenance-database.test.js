import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { normalizeFeed } from '../normalize.js';
import { importEvents } from '../database.js';
import { readSourceState,confirmSourceCheck,cleanupExpiredEvents } from '../source-state.js';

test('PostgreSQL: metadata checkpoints, expiry, saved history and recurring series', {skip:process.env.INGEST_DB_TEST!=='1'}, async t=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  assert.equal(process.env.PGPORT,process.env.INGEST_PG16_TEST==='1'?'55433':'55432');
  const client=new pg.Client();await client.connect();
  const schema=`maintenance_test_${process.pid}`;
  const now=new Date(),before=new Date(now-86400000).toISOString(),after=new Date(+now+86400000).toISOString();
  const metadata={resource_id:'8900fdb2-7f6c-4f50-8581-b463311ff05d',source_url:'https://ckan0.cf.opendata.inter.prod-toronto.ca/feed.json',
    source_last_modified:before,source_size:100,source_hash:'',sha256:'a'.repeat(64),bytes:100};
  const snapshot=()=>normalizeFeed({value:[{id:'occurrence',submission_id:'series',event_name:'Series',event_status:'Approved',
    event_startdate:after,event_expirydate:new Date(+now+2*86400000).toISOString(),calendar_date:after}]},
  {asOf:now.toISOString(),provenance:metadata});
  try {
    await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`);
    await client.query(await fs.readFile(new URL('../../../db/init.sql',import.meta.url),'utf8'));
    await client.query('DROP INDEX ux_events_natural_all');
    for(const name of ['002_notifications','003_event_management','004_realtime_notifications','005_ingest_maintenance']) {
      await client.query(await fs.readFile(new URL(`../../../db/migrations/${name}.sql`,import.meta.url),'utf8'));
    }
    // Reapplying the new migration must not mutate imported data or run cleanup.
    await client.query(await fs.readFile(new URL('../../../db/migrations/005_ingest_maintenance.sql',import.meta.url),'utf8'));
    await t.test('successful transaction establishes checkpoint; changed/check-only never imports',async()=>{
      await importEvents(client,snapshot());
      const original=await readSourceState(client);assert.equal(original.check_status,'current');
      assert.equal((await confirmSourceCheck(client,metadata,now.toISOString())).status,'unchanged');
      assert.equal((await client.query('SELECT source_observed_at FROM event_occurrences')).rows[0].source_observed_at.toISOString(),now.toISOString());
      const changed={...metadata,source_last_modified:after};
      assert.equal((await confirmSourceCheck(client,changed,now.toISOString())).status,'source_changed');
      assert.equal((await client.query('SELECT source_observed_at FROM event_occurrences')).rows[0].source_observed_at,null);
      assert.equal((await readSourceState(client)).revision,original.revision);
      await assert.rejects(()=>confirmSourceCheck(client,changed,now.toISOString(),{requireMatch:true}),/checkpoint changed/);
      await confirmSourceCheck(client,metadata,now.toISOString());
      const broken=snapshot();broken.provenance={...metadata,source_last_modified:after};broken.events[0].title='x'.repeat(256);
      await assert.rejects(()=>importEvents(client,broken),/too long/);
      assert.equal((await readSourceState(client)).revision,original.revision);
    });
    await t.test('real CLI skips the large download on identical revision and check-only never imports a changed revision',async()=>{
      const run=async(extra,publication)=>{
        const result=await promisify(execFile)(process.execPath,[
          '--import',new URL('./fixtures/catalogue-only.js',import.meta.url).href,
          fileURLToPath(new URL('../update_toronto_events.js',import.meta.url)),'--write',...extra],
        {env:{...process.env,PGOPTIONS:`-c search_path=${schema}`,REDIS_HOST:'',INGEST_CHECK_ONLY:'false',
          MOCK_OFFICIAL_METADATA:JSON.stringify(publication)}});
        return result.stdout;
      };
      assert.match(await run([],metadata),/"status":"unchanged","downloaded":false/);
      assert.match(await run(['--check-only'],{...metadata,source_hash:'new-official-hash'}),/"status":"source_changed","downloaded":false/);
      assert.equal((await client.query('SELECT count(*)::int n FROM events')).rows[0].n,1);
      await confirmSourceCheck(client,metadata,now.toISOString());
    });
    await t.test('expiry deletes only finished unreferenced listings and keeps small bookmarked/commented histories',async()=>{
      const owner=(await client.query("SELECT id FROM profiles WHERE username='toronto-open-data'")).rows[0].id;
      const create=async(name,start,end,data={})=>(await client.query(`INSERT INTO events(user_id,title,source,starts_at,ends_at,description,data)
        VALUES($1,$2,'internal',$3,$4,'Full description',$5::jsonb) RETURNING id`,[owner,name,start,end,JSON.stringify(data)])).rows[0].id;
      const removed=await create('Finished',before,before);
      const saved=await create('Saved',before,before,{image:{url:'https://images.unsplash.com/test'},occurrences:[{starts_at:before}]});
      const discussed=await create('Discussed',before,before);
      const ongoing=await create('Recurring ongoing',before,after);
      const inconsistent=await create('Future occurrence',before,before);
      const unknown=await create('Unknown end',before,null);
      await client.query('INSERT INTO bookmarks(user_id,event_id) VALUES($1,$2)',[owner,saved]);
      await client.query("INSERT INTO comments(user_id,event_id,text) VALUES($1,$2,'Keep my comment')",[owner,discussed]);
      await client.query("INSERT INTO event_occurrences(event_id,source_key,starts_at,status) VALUES($1,'future',$2,'scheduled')",[inconsistent,after]);
      await client.query('DELETE FROM in_app_notifications');await client.query('DELETE FROM realtime_outbox');
      assert.deepEqual(await cleanupExpiredEvents(client,now.toISOString()),{deleted:1,archived:2});
      assert.equal((await client.query('SELECT 1 FROM events WHERE id=$1',[removed])).rowCount,0);
      const history=(await client.query('SELECT * FROM events WHERE id=$1',[saved])).rows[0];
      assert.ok(history.archived_at);assert.equal(history.description,null);assert.deepEqual(history.data,{});
      assert.equal((await client.query('SELECT 1 FROM bookmarks WHERE event_id=$1',[saved])).rowCount,1);
      assert.equal((await client.query('SELECT 1 FROM comments WHERE event_id=$1',[discussed])).rowCount,1);
      assert.equal((await client.query('SELECT 1 FROM events WHERE id=ANY($1::int[]) AND archived_at IS NULL',[[ongoing,inconsistent,unknown]])).rowCount,3);
      assert.equal((await client.query('SELECT count(*)::int n FROM in_app_notifications')).rows[0].n,0);
      assert.deepEqual(await cleanupExpiredEvents(client,now.toISOString()),{deleted:0,archived:0});
      await client.query('DELETE FROM bookmarks WHERE event_id=$1',[saved]);
      assert.deepEqual(await cleanupExpiredEvents(client,now.toISOString()),{deleted:1,archived:0});
      await assert.rejects(()=>cleanupExpiredEvents(client,after),/non-future cutoff/);
    });
    await t.test('an officially rescheduled archived series reuses its ID, bookmarks and manual title',async()=>{
      const raw={id:'rescheduled-row',submission_id:'rescheduled',event_name:'Old official title',event_status:'Approved',
        event_startdate:new Date(+now-2*86400000).toISOString(),event_expirydate:before,
        calendar_date:new Date(+now-2*86400000).toISOString()};
      const old=normalizeFeed({value:[raw]},{asOf:new Date(+now-3*86400000).toISOString(),provenance:{}});
      await importEvents(client,old);
      const {rows:[event]}=await client.query("SELECT * FROM events WHERE ref_id='toronto:rescheduled'");
      await client.query("UPDATE events SET title='Curated title',data=data||'{\"editor_overrides\":[\"title\"]}'::jsonb WHERE id=$1",[event.id]);
      await client.query('INSERT INTO bookmarks(user_id,event_id) VALUES($1,$2)',[event.user_id,event.id]);
      await cleanupExpiredEvents(client,now.toISOString());
      assert.ok((await client.query('SELECT archived_at FROM events WHERE id=$1',[event.id])).rows[0].archived_at);
      const moved=normalizeFeed({value:[{...raw,event_name:'New official title',event_startdate:after,
        event_expirydate:new Date(+now+2*86400000).toISOString(),calendar_date:after,event_description:'New full description'}]},
      {asOf:now.toISOString(),provenance:{}});
      await importEvents(client,moved);
      const restored=(await client.query('SELECT * FROM events WHERE id=$1',[event.id])).rows[0];
      assert.equal(restored.archived_at,null);assert.equal(restored.title,'Curated title');
      assert.equal(restored.description,'New full description');assert.equal(restored.starts_at.toISOString(),after);
      assert.equal((await client.query('SELECT 1 FROM bookmarks WHERE event_id=$1',[event.id])).rowCount,1);
    });
  } finally {
    await client.query('SET search_path TO public');await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await client.end();
  }
});
