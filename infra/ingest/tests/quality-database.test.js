import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import fs from 'node:fs/promises';
import {normalizeFeed} from '../normalize.js';
import {importEvents} from '../database.js';
import {recordIngestAlert} from '../quality.js';
test('bad imports roll back; administrator alerts are durable, isolated and deduplicated',{skip:process.env.INGEST_DB_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  const client=new pg.Client();await client.connect();const schema=`ingest_quality_${process.pid}`;
  const start=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+90000000).toISOString();
  const snapshot=(description='Description')=>normalizeFeed({value:[{id:'row',submission_id:'series',event_status:'Approved',event_name:'Title',
    event_startdate:start,event_expirydate:end,calendar_date:start,event_description:description}]},{asOf:new Date().toISOString(),provenance:{}});
  try {
    await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`);
    await client.query(await fs.readFile(new URL('../../../db/init.sql',import.meta.url),'utf8'));
    for(const file of (await fs.readdir(new URL('../../../db/migrations/',import.meta.url))).filter(file=>/^\d.*\.sql$/.test(file)).sort()) {
      await client.query(await fs.readFile(new URL(`../../../db/migrations/${file}`,import.meta.url),'utf8'));
    }
    await client.query("INSERT INTO profiles(username,role) VALUES('administrator','admin'),('ordinary','member')");
    await importEvents(client,snapshot());
    await client.query(`CREATE FUNCTION break_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.description:=NULL; RETURN NEW; END $$;
      CREATE TRIGGER break_import BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION break_import()`);
    let failure;try {await importEvents(client,snapshot('Updated description'));} catch(error) {failure=error;}
    assert.equal(failure.code,'INGEST_INTEGRITY');
    assert.equal((await client.query('SELECT description FROM events')).rows[0].description,'Description');
    await recordIngestAlert(client,failure,'fixture-revision');await recordIngestAlert(client,failure,'fixture-revision');
    const notes=(await client.query('SELECT n.*,p.role FROM in_app_notifications n JOIN profiles p ON p.id=n.user_id')).rows;
    assert.equal(notes.length,1);assert.equal(notes[0].role,'admin');assert.equal(notes[0].kind,'ingest_alert');
    assert.equal((await client.query('SELECT repetitions FROM ingest_alerts')).rows[0].repetitions,2);
    assert.ok((await client.query("SELECT 1 FROM realtime_outbox WHERE event='notification:changed'")).rowCount>0);
    const bad=snapshot();bad.review.candidates=Array.from({length:3},(_,index)=>({ref_id:`bad:${index}`,issue:true}));
    await assert.rejects(()=>importEvents(client,bad),error=>error.code==='INGEST_QUALITY');
    assert.equal((await client.query('SELECT count(*)::int n FROM events')).rows[0].n,1);
  } finally {await client.query('SET search_path TO public');await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}
});
