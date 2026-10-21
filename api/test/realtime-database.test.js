const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Pool}=require('pg');
const {startRealtimeOutbox}=require('../services/realtimeOutbox');

test('durable comment changes, notification isolation, rollback and concurrent dispatch',
  {skip:process.env.NOTIFICATION_DB_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  const schema=`realtime_test_${process.pid}`;
  const admin=new Pool({max:1}),db=new Pool({max:4,options:`-c search_path=${schema}`});
  await admin.query(`CREATE SCHEMA ${schema}`);
  let stopA=()=>{},stopB=()=>{};
  try {
    for(const file of ['init.sql','migrations/001_ingestion_identity.sql','migrations/002_notifications.sql','migrations/003_event_management.sql','migrations/004_realtime_notifications.sql','migrations/005_ingest_maintenance.sql']) {
      await db.query(await fs.readFile(path.resolve(__dirname,'../../db',file),'utf8'));
    }
    const {rows:users}=await db.query("INSERT INTO profiles(username) VALUES('author'),('reader'),('outsider') RETURNING id");
    const {rows:[event]}=await db.query("INSERT INTO events(user_id,title,source,starts_at,ends_at) VALUES($1,'Saved event','internal',now()+interval '1 day',now()+interval '2 days') RETURNING id",[users[0].id]);
    await db.query('INSERT INTO bookmarks(user_id,event_id) VALUES($1,$3),($2,$3)',[users[0].id,users[1].id,event.id]);
    const {rows:[comment]}=await db.query("INSERT INTO comments(event_id,user_id,text) VALUES($1,$2,'Hello') RETURNING id",[event.id,users[0].id]);
    assert.equal((await db.query('SELECT comment_revision FROM events WHERE id=$1',[event.id])).rows[0].comment_revision,'1');
    const notes=(await db.query('SELECT * FROM in_app_notifications')).rows;
    assert.equal(notes.length,1);assert.equal(notes[0].user_id,users[1].id);
    await db.query('DELETE FROM comments WHERE id=$1',[comment.id]);
    assert.equal((await db.query('SELECT comment_revision FROM events WHERE id=$1',[event.id])).rows[0].comment_revision,'2');
    const tx=await db.connect();
    await tx.query('BEGIN');await tx.query("UPDATE events SET status='cancelled' WHERE id=$1",[event.id]);await tx.query('ROLLBACK');tx.release();
    assert.equal((await db.query('SELECT count(*)::int n FROM in_app_notifications')).rows[0].n,1);
    await db.query("UPDATE events SET description='Cosmetic change' WHERE id=$1",[event.id]);
    assert.equal((await db.query('SELECT count(*)::int n FROM in_app_notifications')).rows[0].n,1);
    await db.query("UPDATE events SET starts_at=starts_at+interval '1 hour' WHERE id=$1",[event.id]);
    assert.equal((await db.query('SELECT count(*)::int n FROM in_app_notifications')).rows[0].n,3);
    const sent=[];
    const io={realtimeReady:()=>true,emit:(event,payload)=>sent.push({event,payload}),to:room=>({emit:(event,payload)=>sent.push({room,event,payload})})};
    stopA=startRealtimeOutbox({db,io,intervalMs:20});stopB=startRealtimeOutbox({db,io,intervalMs:20});
    await new Promise(resolve=>setTimeout(resolve,200));stopA();stopB();
    const count=(await db.query('SELECT count(*)::int n FROM realtime_outbox')).rows[0].n;
    assert.equal(sent.length,count);
    assert.equal((await db.query('SELECT count(*)::int n FROM realtime_outbox WHERE published_at IS NULL')).rows[0].n,0);
    assert.ok(sent.some(message=>message.room===`user_${users[1].id}`));
    assert.ok(!sent.some(message=>message.room===`user_${users[2].id}`));
  } finally {stopA();stopB();await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
