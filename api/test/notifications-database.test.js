const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Pool}=require('pg');
const outbox=require('../services/notificationOutbox');
const {savePreferences,readPreferences}=require('../services/preferences');
const {recommendations}=require('../services/recommendations');
const {emailHash}=require('../services/notificationPolicy');
const {runOnce}=require('../workers/notifications');
const {recordFeedback}=require('../services/sesFeedback');

test('notification PostgreSQL lifecycle and concurrency',{skip:process.env.NOTIFICATION_DB_TEST!=='1'},async(t)=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  assert.ok(process.env.PGPORT==='55432' || (process.env.NOTIFICATION_PG16_TEST==='1' && process.env.PGPORT==='55433'));
  const schema=`notification_test_${process.pid}`;
  const admin=new Pool({max:1});
  const db=new Pool({max:4,options:`-c search_path=${schema}`});
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/init.sql'),'utf8'));
    await db.query('DROP INDEX ux_events_natural_all');
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/migrations/002_notifications.sql'),'utf8'));
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/migrations/003_event_management.sql'),'utf8'));
    async function reset() {
      await db.query('TRUNCATE profiles RESTART IDENTITY CASCADE');
      const {rows:[user]}=await db.query("INSERT INTO profiles(username,email,google_id) VALUES('tester','tester@example.test','test-uid') RETURNING *");
      const identity={uid:'test-uid',email:'tester@example.test',emailVerified:true,disabled:false};
      await savePreferences(db,user.id,{reminders_enabled:true,reminder_lead_hours:24},identity);
      const {rows:[event]}=await db.query(`INSERT INTO events(user_id,title,category,source,starts_at,ends_at,latitude,longitude)
        VALUES($1,'Saved art event','Arts & Culture','internal',now()+interval '23 hours 58 minutes',now()+interval '26 hours',43.65,-79.38) RETURNING *`,[user.id]);
      await db.query('INSERT INTO bookmarks(user_id,event_id) VALUES($1,$2)',[user.id,event.id]);
      return {user,event,identity};
    }
    await t.test('independent consent is audited and identity comes from verified server input',async()=>{
      const {user,identity}=await reset();
      const initial=await readPreferences(db,user.id);
      assert.equal(initial.preferences.marketing_enabled,false);
      await savePreferences(db,user.id,{marketing_enabled:true},identity);
      await savePreferences(db,user.id,{marketing_enabled:false},null,{source:'signed_unsubscribe'});
      const {rows}=await db.query("SELECT enabled,source FROM consent_events WHERE purpose='marketing' ORDER BY id");
      assert.deepEqual(rows,[{enabled:true,source:'settings'},{enabled:false,source:'signed_unsubscribe'}]);
      assert.equal((await readPreferences(db,user.id)).preferences.reminders_enabled,true);
    });
    await t.test('repeated scheduling and concurrent claims produce one delivery',async()=>{
      await reset();await outbox.scheduleNotifications(db);await outbox.scheduleNotifications(db);
      assert.equal((await db.query('SELECT count(*)::int n FROM notification_outbox')).rows[0].n,1);
      const claims=await Promise.all([outbox.claimNext(db),outbox.claimNext(db)]);
      assert.equal(claims.filter(Boolean).length,1);
    });
    await t.test('opt-out, removed bookmark, changed schedule and suppression cancel before dispatch',async()=>{
      for(const action of ['optout','bookmark','reschedule','suppression']) {
        const {user,event,identity}=await reset();await outbox.scheduleNotifications(db);
        const job=await outbox.claimNext(db);
        if(action==='optout') await savePreferences(db,user.id,{reminders_enabled:false},identity);
        if(action==='bookmark') await db.query('DELETE FROM bookmarks');
        if(action==='reschedule') await db.query("UPDATE events SET starts_at=starts_at+interval '1 hour' WHERE id=$1",[event.id]);
        if(action==='suppression') await db.query("INSERT INTO email_suppressions(email_hash,reason) VALUES($1,'complaint') ON CONFLICT DO NOTHING",[emailHash(identity.email)]);
        assert.equal(await outbox.beginDispatch(db,job,identity),null);
        assert.equal((await db.query('SELECT status FROM notification_outbox')).rows[0].status,'cancelled');
        await db.query('DELETE FROM email_suppressions');
      }
    });
    await t.test('expired leases recover; ambiguous dispatch never automatically retries',async()=>{
      await reset();await outbox.scheduleNotifications(db);const job=await outbox.claimNext(db);
      await db.query("UPDATE notification_outbox SET lease_until=now()-interval '1 minute' WHERE id=$1",[job.id]);
      await outbox.scheduleNotifications(db);const retried=await outbox.claimNext(db);
      assert.equal(retried.id,job.id);assert.equal(retried.attempts,2);
      await db.query("UPDATE notification_outbox SET status='dispatching',lease_until=now()-interval '1 minute' WHERE id=$1",[job.id]);
      await outbox.scheduleNotifications(db);
      assert.equal((await db.query('SELECT status FROM notification_outbox')).rows[0].status,'uncertain');
      assert.equal(await outbox.claimNext(db),undefined);
    });
    await t.test('dry run retains unsent jobs; fake live provider records one success without external mail',async()=>{
      const {identity}=await reset();
      const preview=await runOnce({db,env:{},provider:{enabled:false}});
      assert.equal(preview.mode,'dry_run');assert.equal(preview.would_send,1);
      assert.equal((await db.query('SELECT status FROM notification_outbox')).rows[0].status,'pending');
      let calls=0;
      const options={db,env:{UNSUBSCRIBE_SIGNING_SECRET:'test-only-signing-secret-not-a-real-key',PUBLIC_APP_URL:'https://example.test'},
        provider:{enabled:true,async send(message){calls++;assert.equal(message.to,identity.email);return {messageId:'test-message'};}},verifyIdentity:async()=>identity};
      assert.equal((await runOnce(options)).sent,1);assert.equal((await runOnce(options)).sent,0);assert.equal(calls,1);
      assert.equal((await db.query('SELECT provider_message_id FROM notification_outbox')).rows[0].provider_message_id,'test-message');
    });
    await t.test('recommendations use bookmarks only after personalization opt-in',async()=>{
      const {user,identity}=await reset();
      await db.query(`INSERT INTO events(user_id,title,category,source,starts_at,ends_at,latitude,longitude) VALUES
        ($1,'Music sooner','Entertainment & Leisure','internal',now()+interval '2 hours',now()+interval '3 hours',43.65,-79.38),
        ($1,'Art later','Arts & Culture','internal',now()+interval '4 hours',now()+interval '5 hours',43.65,-79.38)`,[user.id]);
      await outbox.scheduleNotifications(db);
      assert.equal((await recommendations(db,user.id)).events[0].title,'Music sooner');
      await savePreferences(db,user.id,{personalization_enabled:true},identity);
      const result=await recommendations(db,user.id);
      assert.equal(result.personalized,true);assert.equal(result.events[0].title,'Art later');assert.match(result.events[0].reason,/saved arts/);
      assert.equal(result.events.some(e=>e.title==='Saved art event'),false);
    });
    await t.test('official starts refresh independently of unchanged event content and absence suppresses',async()=>{
      const {user}=await reset();
      const starts=new Date(Date.now()+86400000).toISOString();
      const ends=new Date(Date.now()+90000000).toISOString();
      const data={import_metadata:{provider:'toronto-open-data'},import_snapshot:{starts_at:starts,ends_at:ends,content_hash:'test-hash'},
        occurrences:[{source_row_id:'test-source-start',starts_at:starts}]};
      await db.query(`INSERT INTO events(user_id,title,source,ref_id,starts_at,ends_at,data) VALUES($1,'Official','external','toronto:test',$2,$3,$4)`,[user.id,starts,ends,data]);
      await db.query('SELECT refresh_toronto_occurrences($1::text[],now())',[['toronto:test']]);
      assert.equal((await db.query("SELECT status FROM event_occurrences WHERE source_key='test-source-start'")).rows[0].status,'scheduled');
      await db.query('SELECT refresh_toronto_occurrences($1::text[],now())',[['toronto:another']]);
      assert.equal((await db.query("SELECT status FROM event_occurrences WHERE source_key='test-source-start'")).rows[0].status,'source_missing');
    });
    await t.test('verified feedback replay is idempotent and stores no raw recipient or message',async()=>{
      await reset();
      const envelope={MessageId:'test-feedback-replay',Message:JSON.stringify({notificationType:'Complaint',
        complaint:{complainedRecipients:[{emailAddress:'complaint@example.test'}]}})};
      assert.deepEqual(await recordFeedback(db,envelope),{duplicate:false,suppressions:1});
      assert.deepEqual(await recordFeedback(db,envelope),{duplicate:true,suppressions:0});
      const {rows:[record]}=await db.query('SELECT * FROM email_suppressions WHERE email_hash=$1',[emailHash('complaint@example.test')]);
      assert.equal(record.reason,'complaint');assert.equal(Object.hasOwn(record,'email'),false);
    });
  } finally {
    await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
