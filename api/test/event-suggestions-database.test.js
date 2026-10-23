const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Pool}=require('pg');
const {createEventModel}=require('../models/eventModel');
const {createEventSuggestions}=require('../services/eventSuggestions');
const {publicEvent}=require('../services/publicEvents');

test('community review is private, versioned, atomic and adds only approved unique contributors',
  {skip:process.env.NOTIFICATION_DB_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  const schema=`contributions_test_${process.pid}`,admin=new Pool({max:1}),db=new Pool({max:6,options:`-c search_path=${schema}`});
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/init.sql'),'utf8'));
    for(const file of (await fs.readdir(path.resolve(__dirname,'../../db/migrations'))).filter(name=>/^\d.*\.sql$/.test(name)).sort()) {
      await db.query(await fs.readFile(path.resolve(__dirname,'../../db/migrations',file),'utf8'));
    }
    const {rows:users}=await db.query("INSERT INTO profiles(username,role) VALUES('reporter','member'),('contributor','member'),('reviewer','admin'),('another-reviewer','admin'),('other','member') RETURNING id,role");
    const [owner,writer,reviewer,otherAdmin,other]=users,model=createEventModel(db),store=createEventSuggestions(db);
    const input={user_id:owner.id,title:'Community gathering',description:'An event',category:'Other',lat:43.7,lng:-79.4,
      location_address:'Toronto',starts_at:'2027-01-01T15:00:00Z',ends_at:'2027-01-01T17:00:00Z',submission:{role:'reporter'},organizer_name:'Community Centre'};
    let event=(await model.create(input)).rows[0];
    const get=async()=>((await model.getById(event.id)).rows[0]);
    const proposal=(person,title,version=event.version)=>store.submit(event.id,person,{title,version,explanation:'Correct the event information.'});
    assert.equal(event.contributor_count,1);
    assert.equal(publicEvent(event).submission_role,'reporter');
    assert.equal(publicEvent(event).data.organizer_name,'Community Centre');
    const pending=await proposal(writer,'Updated gathering');
    assert.equal((await get()).title,input.title);
    assert.equal((await get()).contributor_count,1);
    await assert.rejects(()=>proposal(writer,'Duplicate pending'),{status:409});
    await assert.rejects(()=>store.get(pending.id,other),{status:404});
    await assert.rejects(()=>store.list(writer,{review:true}),{status:403});
    await assert.rejects(()=>store.review(pending.id,writer,{decision:'approve'}),{status:403});
    assert.equal((await store.list(reviewer,{review:true})).items.length,1);
    await store.review(pending.id,reviewer,{decision:'approve',note:'Thanks for the correction.'});
    event=await get();assert.equal(event.title,'Updated gathering');assert.equal(event.contributor_count,2);
    assert.equal((await store.get(pending.id,writer)).status,'approved');
    const notice=(await db.query("SELECT * FROM in_app_notifications WHERE user_id=$1 AND suggestion_id=$2",[writer.id,pending.id])).rows[0];
    assert.equal(notice.kind,'suggestion_approved');assert.match(notice.message,/Thanks for the correction/);
    assert.equal((await db.query("SELECT count(*)::int n FROM realtime_outbox WHERE room=$1 AND event='notification:changed'",[`user_${writer.id}`])).rows[0].n,1);
    const repeat=await proposal(writer,'Another useful correction');await store.review(repeat.id,reviewer,{decision:'approve'});
    event=await get();assert.equal(event.contributor_count,2,'one user is counted once across multiple accepted changes');
    const rejected=await proposal(other,'Unverified information');
    await assert.rejects(()=>store.review(rejected.id,reviewer,{decision:'reject'}),{status:400});
    await store.review(rejected.id,reviewer,{decision:'reject',note:'Please include a source.'});
    assert.equal((await get()).contributor_count,2);assert.equal((await get()).title,event.title);
    assert.equal((await db.query('SELECT kind FROM in_app_notifications WHERE suggestion_id=$1 AND user_id=$2',[rejected.id,other.id])).rows[0].kind,'suggestion_rejected');
    const stale=await proposal(other,'Stale proposal');
    event=(await model.update({id:event.id,actor_id:owner.id,title:'Changed while awaiting review'})).rows[0];
    await assert.rejects(()=>store.review(stale.id,reviewer,{decision:'approve'}),{status:409});
    assert.equal((await store.get(stale.id,other)).status,'pending');
    await store.review(stale.id,reviewer,{decision:'reject',note:'The event changed; submit an updated suggestion.'});
    const concurrent=await proposal(other,'Reviewed exactly once');
    const reviews=await Promise.allSettled([reviewer,otherAdmin].map(user=>store.review(concurrent.id,user,{decision:'approve'})));
    assert.equal(reviews.filter(result=>result.status==='fulfilled').length,1);
    assert.equal((await db.query("SELECT count(*)::int n FROM in_app_notifications WHERE suggestion_id=$1 AND kind='suggestion_approved'",[concurrent.id])).rows[0].n,1);
    event=await get();assert.equal(event.contributor_count,3);
    const unsafe=await store.submit(event.id,writer,{version:event.version,description:'<script>alert(1)</script>',explanation:'Literal text must remain text.'});
    await store.review(unsafe.id,reviewer,{decision:'approve'});event=await get();assert.equal(event.description,'<script>alert(1)</script>');
    const own=await proposal(reviewer,'Self approval');
    await assert.rejects(()=>store.review(own.id,reviewer,{decision:'approve'}),{status:403});
    await store.review(own.id,otherAdmin,{decision:'reject',note:'Reviewed by a different administrator.'});
    const rollback=await proposal(owner,'Must roll back if notification storage fails');
    const failingStore=createEventSuggestions({
      async connect(){const client=await db.connect();return {release:()=>client.release(),query(sql,...args){
        if(sql.includes('INSERT INTO in_app_notifications')) throw Object.assign(new Error('Injected notification failure'),{code:'TEST_FAILURE'});
        return client.query(sql,...args);
      }};},query:(...args)=>db.query(...args),
    });
    const beforeRollback=await get();
    await assert.rejects(()=>failingStore.review(rollback.id,reviewer,{decision:'approve'}));
    assert.equal((await get()).title,beforeRollback.title);
    assert.equal((await get()).version,beforeRollback.version);
    assert.equal((await store.get(rollback.id,owner)).status,'pending');
    const organizer=(await model.create({...input,title:'Organizer listing',submission:{role:'organizer',organizer_confirmed_at:new Date().toISOString()}})).rows[0];
    await assert.rejects(()=>store.submit(organizer.id,writer,{title:'Cannot edit this',version:organizer.version,explanation:'No bypass'}),{status:403});
    await model.delete(event.id);
    await store.review(rollback.id,reviewer,{decision:'reject',note:'This event was removed.'});
    assert.equal((await store.get(rollback.id,owner)).event_id,null);
    assert.equal((await db.query("SELECT event_id FROM in_app_notifications WHERE suggestion_id=$1 AND kind='suggestion_rejected'",[rollback.id])).rows[0].event_id,null);
  } finally {await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
