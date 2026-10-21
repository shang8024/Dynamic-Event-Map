const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Pool}=require('pg');
const {createClient}=require('redis');
const {createCommentPreview,cacheKey}=require('../services/commentPreview');

test('real PostgreSQL and Redis keep previews current for inserts, edits, deletes, moves and rollbacks',
  {skip:process.env.COMMENT_PREVIEW_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.REDIS_HOST,'127.0.0.1');assert.equal(process.env.REDIS_PORT,'56379');
  const schema=`comment_preview_test_${process.pid}`,admin=new Pool({max:1}),db=new Pool({max:3,options:`-c search_path=${schema}`});
  const redis=createClient({socket:{host:process.env.REDIS_HOST,port:Number(process.env.REDIS_PORT),reconnectStrategy:false},password:process.env.REDIS_PASSWORD});
  redis.on('error',()=>{});await redis.connect();await admin.query(`CREATE SCHEMA ${schema}`);
  const keys=[];
  try {
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/init.sql'),'utf8'));
    for(const file of (await fs.readdir(path.resolve(__dirname,'../../db/migrations'))).filter(file=>/^\d.*\.sql$/.test(file)).sort()) {
      await db.query(await fs.readFile(path.resolve(__dirname,'../../db/migrations',file),'utf8'));
    }
    const {rows:[author]}=await db.query("INSERT INTO profiles(username) VALUES('preview-author') RETURNING id");
    const {rows:[reader]}=await db.query("INSERT INTO profiles(username) VALUES('preview-reader') RETURNING id");
    // Keep Redis keys outside normal local event IDs and clean every revision.
    const eventIds=[1900000000+process.pid%100000,1900100000+process.pid%100000];
    for(const id of eventIds) await db.query("INSERT INTO events(id,user_id,title,source) VALUES($1,$2,'Preview event','internal')",[id,author.id]);
    await db.query('INSERT INTO bookmarks(event_id,user_id) VALUES($1,$2)',[eventIds[0],reader.id]);
    for(const id of eventIds) for(let revision=0;revision<20;revision++) keys.push(cacheKey(id,revision));
    await redis.del(keys);
    const {rows:comments}=await db.query(`INSERT INTO comments(event_id,user_id,text,created_at)
      SELECT $1,$2,'Comment '||n,'2026-10-01 12:00:00'::timestamp FROM generate_series(1,6) n RETURNING id`,[eventIds[0],author.id]);
    const read=createCommentPreview({db,redis}),first=await read(eventIds[0]);
    assert.equal(first.total,6);assert.equal(first.comments.length,3);assert.equal(first.revision,'6');
    assert.deepEqual(first.comments.map(row=>row.id),comments.slice(-3).reverse().map(row=>row.id));
    const ttl=await redis.ttl(cacheKey(eventIds[0],6));assert.ok(ttl>86300&&ttl<=86400);
    assert.deepEqual(await read(eventIds[0]),first);
    await db.query("UPDATE comments SET text=$2,created_at='2026-10-02 12:00:00' WHERE id=$1",[comments[0].id,'Edited first'+'x'.repeat(6000)]);
    const edited=await read(eventIds[0]);assert.equal(edited.revision,'7');assert.ok(edited.comments[0].text.startsWith('Edited first'));assert.equal(edited.comments[0].text.length,5000);
    const tx=await db.connect();await tx.query('BEGIN');await tx.query("UPDATE comments SET text='Rolled back' WHERE id=$1",[comments[0].id]);await tx.query('ROLLBACK');tx.release();
    assert.deepEqual(await read(eventIds[0]),edited);
    await db.query('DELETE FROM comments WHERE id=$1',[comments[0].id]);
    const deleted=await read(eventIds[0]);assert.equal(deleted.total,5);assert.equal(deleted.revision,'8');assert.ok(deleted.comments.every(row=>row.id!==comments[0].id));
    await read(eventIds[1]);
    await db.query('UPDATE comments SET event_id=$1 WHERE id=$2',[eventIds[1],comments[5].id]);
    assert.equal((await read(eventIds[0])).total,4);assert.equal((await read(eventIds[1])).total,1);
    const revision=(await db.query('SELECT comment_revision FROM events WHERE id=$1',[eventIds[1]])).rows[0].comment_revision;
    await db.query('UPDATE comments SET text=text WHERE id=$1',[comments[5].id]);
    assert.equal((await db.query('SELECT comment_revision FROM events WHERE id=$1',[eventIds[1]])).rows[0].comment_revision,revision);
    assert.equal((await db.query("SELECT count(*)::int n FROM realtime_outbox WHERE event='comments:changed'")).rows[0].n,10);
    assert.equal((await db.query('SELECT count(*)::int n FROM in_app_notifications')).rows[0].n,6,'edits and deletions do not resend new-comment notifications');
    await db.query('DELETE FROM events WHERE id=$1',[eventIds[1]]);assert.equal(await read(eventIds[1]),null);
  } finally {
    if(keys.length) await redis.del(keys);await redis.quit();await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
