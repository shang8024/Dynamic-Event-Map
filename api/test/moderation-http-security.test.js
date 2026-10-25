const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
const express=require('express'),{Pool}=require('pg');
const {createEventPublications}=require('../services/eventPublications');
const {createEventSuggestions}=require('../services/eventSuggestions');
const {createEventModel}=require('../models/eventModel');

async function loadModule(relative,dependencies) {
  const filename=path.resolve(__dirname,'..',relative),module={exports:{}};
  vm.runInNewContext(await fs.readFile(filename,'utf8'),{module,exports:module.exports,console,require(name){
    assert.ok(Object.hasOwn(dependencies,name),`Unexpected dependency: ${name}`);return dependencies[name];
  }},{filename});
  return module.exports;
}

test('HTTP moderation boundaries reject direct URLs, forged claims, ID guesses and stale administrative privileges',
  {skip:process.env.NOTIFICATION_DB_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  const schema=`moderation_http_${process.pid}`,admin=new Pool({max:1}),db=new Pool({max:6,options:`-c search_path=${schema}`});
  let server;
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/init.sql'),'utf8'));
    const migrations=path.resolve(__dirname,'../../db/migrations');
    for(const name of (await fs.readdir(migrations)).filter(name=>/^\d.*\.sql$/.test(name)).sort()) await db.query(await fs.readFile(path.join(migrations,name),'utf8'));
    const {rows:users}=await db.query(`INSERT INTO profiles(username,role,email,google_id) VALUES
      ('author-a','member','a@example.invalid','fixture-a'),('author-b','member','b@example.invalid','fixture-b'),
      ('unrelated','member','other@example.invalid','fixture-other'),('reviewer','admin','admin@example.invalid','fixture-admin') RETURNING *`);
    const [author,otherAuthor,unrelated,reviewer]=users,publications=createEventPublications(db),suggestions=createEventSuggestions(db),events=createEventModel(db);
    const draft={title:'Private first event',description:'Not public yet',category:'Other',latitude:43.7,longitude:-79.4,
      location_address:'Toronto',occurrences:[{key:'one',starts_at:'2030-01-01T15:00:00Z',ends_at:'2030-01-01T17:00:00Z'}],
      submission:{role:'reporter'},image:{url:'https://images.unsplash.com/fixture',source:'link'}};
    const first=(await publications.submit({...draft,user_id:author.id})).rows[0].submission_id;
    const second=(await publications.submit({...draft,user_id:otherAuthor.id,title:'Another private event'})).rows[0].submission_id;
    const community=(await events.create({...draft,user_id:author.id,source:'internal',lat:draft.latitude,lng:draft.longitude})).rows[0];
    const suggestion=await suggestions.submit(community.id,otherAuthor,{title:'Suggested title',version:community.version,explanation:'A correction.'});
    // Only the SDK verification boundary is simulated. The production auth
    // middleware still loads role/identity/disabled status from the real DB.
    // Signed, expired and tampered Firebase tokens are tested independently.
    const identities=new Map(users.map(user=>[user.google_id,{uid:user.google_id,email:user.email,email_verified:true}]));
    const auth=await loadModule('middleware/auth.js',{
      '../config/firebaseAdmin':{auth:()=>({async verifyIdToken(token){if(!identities.has(token)) throw new Error('Invalid test identity');return identities.get(token);}})},
      '../models/user':{async findOne({where}){const key=Object.hasOwn(where,'google_id')?'google_id':'email';return (await db.query(`SELECT * FROM profiles WHERE ${key}=$1`,[where[key]])).rows[0];},create(){assert.fail('All fixture identities already exist');}},
      'node:crypto':require('node:crypto'),'./rateLimit':{authenticated:async()=>true},'../services/accountAccess':require('../services/accountAccess'),
    });
    let imageCalls=0;
    const publicationRoutes=await loadModule('routes/eventPublications.js',{'express':express,'../middleware/auth':auth,'../config/db':db,
      '../services/eventPublications':require('../services/eventPublications'),'../services/imageErrors':require('../services/imageErrors'),
      '../services/imageDelivery':{async getDeliveredImage(){imageCalls++;return Buffer.from('RIFF fixture WEBP');}}});
    const suggestionRoutes=await loadModule('routes/eventSuggestions.js',{'express':express,'../middleware/auth':auth,'../config/db':db,
      '../services/eventSuggestions':require('../services/eventSuggestions')});
    const app=express();app.use(express.json({limit:'100kb'}));app.use('/api',publicationRoutes,suggestionRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    async function request(url,token,body,extra={}) {
      const result=await fetch(origin+'/api'+url,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),
        ...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
      assert.equal(result.headers.get('cache-control'),'no-store',url);
      return result;
    }
    const routes=[`/event-publications?review=true`,`/event-publications/${first}`,`/event-publications/${first}/image`,
      '/event-suggestions?review=true',`/event-suggestions/${suggestion.id}`];
    for(const route of routes) for(const token of [null,'unsigned-fake-token']) assert.equal((await request(route,token)).status,401,route);
    for(const prefix of ['event-publications','event-suggestions']) assert.equal((await request(`/${prefix}/1/review`,null,{decision:'approve'})).status,401);
    const snapshot=async()=>{
      const result={};
      for(const table of ['profiles','events','event_publication_requests','event_change_requests','in_app_notifications','realtime_outbox','event_edit_history','event_contributors']) {
        result[table]=(await db.query(`SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) hash FROM ${table} t`)).rows[0].hash;
      }
      return result;
    };
    const before=await snapshot();
    for(const user of [author,otherAuthor,unrelated]) {
      for(const prefix of ['event-publications','event-suggestions']) {
        assert.equal((await request(`/${prefix}?review=true&role=admin&user_id=${reviewer.id}`,user.google_id)).status,403);
        const id=prefix==='event-publications'?first:suggestion.id;
        assert.equal((await request(`/${prefix}/${id}/review`,user.google_id,{decision:'approve',role:'admin',user_id:reviewer.id},
          {'X-Role':'admin','X-User-Id':String(reviewer.id)})).status,403);
      }
    }
    for(const suffix of ['', '/image']) assert.equal((await request(`/event-publications/${first}${suffix}`,unrelated.google_id)).status,404);
    assert.equal((await request(`/event-suggestions/${suggestion.id}`,unrelated.google_id)).status,404);
    assert.equal(imageCalls,0,'No unauthorized private photo request reaches decoding or network delivery');
    assert.equal((await request(`/event-publications/${first}`,author.google_id)).status,200);
    assert.equal((await request(`/event-publications/${second}`,author.google_id)).status,404);
    const own=await (await request(`/event-publications?user_id=${otherAuthor.id}`,author.google_id)).json();
    assert.deepEqual(own.items.map(item=>item.id),[first]);
    for(const id of ['0','-1','1 OR 1=1','1;DROP TABLE profiles','9999999999999999999']) {
      assert.equal((await request('/event-publications/'+encodeURIComponent(id),author.google_id)).status,400);
      assert.equal((await request('/event-suggestions/'+encodeURIComponent(id),author.google_id)).status,400);
    }
    assert.deepEqual(await snapshot(),before,'Unauthorized requests must not change data, trust, public feeds or notifications');
    assert.equal((await request('/event-publications?review=true',reviewer.google_id)).status,200);
    assert.equal((await request(`/event-publications/${first}/image`,reviewer.google_id)).status,200);assert.equal(imageCalls,1);
    // A revoked/disabled role must not survive through a cached req.user object.
    for(const update of ["role='member'","role='admin',disabled_at=now()"]){
      await db.query(`UPDATE profiles SET ${update} WHERE id=$1`,[reviewer.id]);
      for(const store of [publications,suggestions]) {
        const id=store===publications?first:suggestion.id;
        await assert.rejects(()=>store.list(reviewer,{review:true}),{status:403});
        await assert.rejects(()=>store.get(id,reviewer),{status:404});
        await assert.rejects(()=>store.review(id,reviewer,{decision:'approve'}),{status:403});
      }
    }
    await db.query("UPDATE profiles SET role='admin',disabled_at=NULL WHERE id=$1",[reviewer.id]);
    const crossA=(await publications.submit({...draft,user_id:author.id,title:'Cross review A'})).rows[0].submission_id;
    const crossB=(await publications.submit({...draft,user_id:otherAuthor.id,title:'Cross review B'})).rows[0].submission_id;
    await db.query("UPDATE profiles SET role='admin' WHERE id=ANY($1::integer[])",[[author.id,otherAuthor.id]]);
    assert.equal((await request(`/event-publications/${crossA}/review`,author.google_id,{decision:'approve'})).status,403,'An administrator cannot approve their own first event');
    assert.equal((await request(`/event-suggestions/${suggestion.id}/review`,otherAuthor.google_id,{decision:'approve'})).status,403,'An administrator cannot approve their own suggestion');
    const crossReviews=await Promise.all([
      request(`/event-publications/${crossA}/review`,otherAuthor.google_id,{decision:'reject',note:'Reviewed by a different administrator.'}),
      request(`/event-publications/${crossB}/review`,author.google_id,{decision:'reject',note:'Reviewed by a different administrator.'}),
    ]);
    assert.deepEqual(crossReviews.map(result=>result.status),[200,200],'Opposite administrator/profile order must not deadlock');
    await db.query("UPDATE profiles SET role='member' WHERE id=ANY($1::integer[])",[[author.id,otherAuthor.id]]);
    assert.equal((await request(`/event-publications/${second}/review`,reviewer.google_id,{decision:'reject',note:'Missing source.'})).status,200);
    const rejected=await (await request(`/event-publications/${second}`,otherAuthor.google_id)).json();
    assert.equal(rejected.status,'rejected');assert.equal(rejected.review_note,'Missing source.');
    const approved=await request(`/event-publications/${first}/review`,reviewer.google_id,{decision:'approve'});assert.equal(approved.status,200);
    assert.equal((await request(`/event-publications/${first}/review`,reviewer.google_id,{decision:'reject',note:'Duplicate decision'})).status,409);
    assert.equal((await request(`/event-suggestions/${suggestion.id}/review`,reviewer.google_id,{decision:'approve'})).status,200);
    assert.equal((await request(`/event-suggestions/${suggestion.id}/review`,reviewer.google_id,{decision:'approve'})).status,409);
    const kinds=(await db.query("SELECT kind FROM in_app_notifications WHERE user_id IN ($1,$2)",[author.id,otherAuthor.id])).rows.map(row=>row.kind);
    assert.ok(kinds.includes('publication_approved')&&kinds.includes('publication_rejected')&&kinds.includes('suggestion_approved'));
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
