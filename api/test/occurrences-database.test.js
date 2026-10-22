const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Pool}=require('pg');
const {createEventModel}=require('../models/eventModel');
const {scheduleNotifications}=require('../services/notificationOutbox');
const {publicEvent}=require('../services/publicEvents');
test('multi-occurrence writes, reminder identities and final expiry are atomic',{skip:process.env.NOTIFICATION_DB_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  const schema=`occurrences_test_${process.pid}`,admin=new Pool({max:1}),db=new Pool({options:`-c search_path=${schema}`});
  const at=hours=>new Date(Date.now()+hours*3600000).toISOString();
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/init.sql'),'utf8'));
    for(const file of (await fs.readdir(path.resolve(__dirname,'../../db/migrations'))).filter(file=>/^\d.*\.sql$/.test(file)).sort()) {
      await db.query(await fs.readFile(path.resolve(__dirname,'../../db/migrations',file),'utf8'));
    }
    const users=(await db.query("INSERT INTO profiles(username,role) VALUES('owner','admin'),('follower','member') RETURNING id")).rows;
    const model=createEventModel(db),first=at(23.98),second=at(26);
    const {rows:[event]}=await model.create({user_id:users[0].id,title:'Two date ranges',description:'Separate sessions',category:'Other',
      lat:43.7,lng:-79.4,location_address:'Toronto',occurrences:[{key:'first',starts_at:first,ends_at:at(25)},{key:'second',starts_at:second,ends_at:at(27)}]});
    assert.equal((await db.query("SELECT count(*)::int n FROM event_occurrences WHERE status='scheduled'")).rows[0].n,2);
    await db.query('INSERT INTO bookmarks(user_id,event_id) VALUES($1,$2)',[users[1].id,event.id]);
    await db.query("INSERT INTO notification_preferences(user_id,reminders_enabled,delivery_email,verified_uid) VALUES($1,true,'verified@example.test','fixture-uid')",[users[1].id]);
    await scheduleNotifications(db);await scheduleNotifications(db);
    assert.equal((await db.query('SELECT count(*)::int n FROM notification_outbox')).rows[0].n,2);
    await model.update({id:event.id,actor_id:users[0].id,occurrences:[{key:'first',starts_at:at(-3),ends_at:at(-2)},
      {key:'second',starts_at:second,ends_at:at(27)}]});
    assert.deepEqual((await db.query('SELECT * FROM cleanup_expired_events(now())')).rows[0],{deleted:0,archived:0});
    assert.equal(Date.parse((await model.getById(event.id)).rows[0].next_occurrence.starts_at),Date.parse(second));
    await model.update({id:event.id,actor_id:users[0].id,occurrences:[{key:'first',starts_at:at(-3),ends_at:at(-2)},
      {key:'second',starts_at:at(-1),ends_at:null}]});
    assert.equal((await model.getById(event.id)).rows[0].ends_at,null);
    assert.deepEqual((await db.query('SELECT * FROM cleanup_expired_events(now())')).rows[0],{deleted:0,archived:0});
    await assert.rejects(()=>model.update({id:event.id,occurrences:[{key:'x',starts_at:second,ends_at:first}]}),/end after/);
    assert.equal((await db.query("SELECT count(*)::int n FROM event_occurrences WHERE status='scheduled'")).rows[0].n,2);
    await model.update({id:event.id,actor_id:users[0].id,occurrences:[{key:'first',starts_at:at(-3),ends_at:at(-2)},
      {key:'second',starts_at:at(-1),ends_at:at(-0.5)}]});
    await scheduleNotifications(db);
    assert.equal((await db.query("SELECT count(*)::int n FROM notification_outbox WHERE status IN ('pending','leased')")).rows[0].n,0);
    assert.deepEqual((await db.query('SELECT * FROM cleanup_expired_events(now())')).rows[0],{deleted:0,archived:1});
    assert.equal((await db.query('SELECT count(*)::int n FROM bookmarks')).rows[0].n,1);
  } finally {await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('publisher declarations persist with the listing and survive later edits without altering legacy events',
  {skip:process.env.NOTIFICATION_DB_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  const schema=`event_submission_test_${process.pid}`,admin=new Pool({max:1}),db=new Pool({options:`-c search_path=${schema}`});
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/init.sql'),'utf8'));
    for(const file of (await fs.readdir(path.resolve(__dirname,'../../db/migrations'))).filter(file=>/^\d.*\.sql$/.test(file)).sort()) {
      await db.query(await fs.readFile(path.resolve(__dirname,'../../db/migrations',file),'utf8'));
    }
    const owner=(await db.query("INSERT INTO profiles(username) VALUES('publisher') RETURNING id")).rows[0];
    const model=createEventModel(db),input={user_id:owner.id,title:'A local event',description:'Community gathering',
      category:'Other',lat:43.7,lng:-79.4,location_address:'Toronto',
      starts_at:'2027-01-01T15:00:00Z',ends_at:'2027-01-01T17:00:00Z'};
    for(const submission of [{role:'reporter'},{role:'organizer',organizer_confirmed_at:new Date().toISOString()},undefined]) {
      const {rows:[created]}=await model.create({...input,submission});
      assert.deepEqual(created.data.submission,submission);
      const {rows:[updated]}=await model.update({id:created.id,actor_id:owner.id,title:'Updated local event',
        submission:{role:'forged'},data:{submission:{role:'forged'}}});
      assert.deepEqual(updated.data.submission,submission);
      assert.equal(Object.hasOwn(publicEvent((await model.getById(created.id)).rows[0]).data,'submission'),false);
    }
  } finally {await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
