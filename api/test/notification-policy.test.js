const test=require('node:test');
const assert=require('node:assert/strict');
const policy=require('../services/notificationPolicy');
const {eligibility}=require('../services/notificationOutbox');
const {classifySendFailure,createEmailProvider}=require('../services/emailProvider');
const {buildMessage,formatDate}=require('../services/notificationMessages');

const key='test-signing-key-only-not-a-real-secret';
test('consent defaults are independent and recipient/identity cannot be supplied as settings',()=>{
  assert.equal(policy.publicPreferences().marketing_enabled,false);
  assert.equal(policy.publicPreferences().reminders_enabled,false);
  assert.equal(policy.publicPreferences().personalization_enabled,false);
  assert.deepEqual(policy.validatePreferences({marketing_enabled:true}),{marketing_enabled:true});
  for(const input of [{delivery_email:'other@example.test'},{reminders_enabled:'true'},{reminder_lead_hours:2},{timezone:'UTC'},[]]) {
    assert.throws(()=>policy.validatePreferences(input));
  }
});
test('unsubscribe signature covers user, purpose, expiry and survives legitimate reuse',()=>{
  const now=Date.parse('2026-10-21T12:00:00Z');
  const token=policy.signUnsubscribe(7,'marketing',key,now);
  assert.deepEqual(policy.verifyUnsubscribe(token,key,now),{userId:7,scope:'marketing'});
  assert.deepEqual(policy.verifyUnsubscribe(token,key,now+10000),{userId:7,scope:'marketing'});
  const [encoded,signature]=token.split('.');
  const changed=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(encoded,'base64url')),u:8})).toString('base64url');
  assert.throws(()=>policy.verifyUnsubscribe(`${changed}.${signature}`,key,now));
  assert.throws(()=>policy.verifyUnsubscribe(token,key,now+366*86400000));
  assert.throws(()=>policy.verifyUnsubscribe(token,'different key',now));
});
test('delivery requires all explicit gates; a disabled provider never sends',async()=>{
  assert.deepEqual(policy.deliveryState({}),{enabled:false,mode:'dry_run'});
  assert.equal(policy.deliveryState({EMAIL_DELIVERY_ENABLED:'true',EMAIL_PROVIDER:'ses'}).enabled,false);
  await assert.rejects(()=>createEmailProvider({}).send({}),/disabled/);
  assert.deepEqual(classifySendFailure({name:'TimeoutError'},1),{status:'uncertain',code:'provider_result_unknown'});
  assert.equal(classifySendFailure({name:'TooManyRequestsException'},1).status,'pending');
  assert.equal(classifySendFailure({name:'TooManyRequestsException'},5).status,'failed');
});
test('reminders fail closed after reschedule, stale source, opt-out or expiry',()=>{
  const now=Date.parse('2026-10-21T12:00:00Z'),start=now+3600000;
  const row={delivery_email:'test@example.test',verified_uid:'test-user',kind:'reminder',expires_at:now+300000,
    reminders_enabled:true,bookmarked:true,occurrence_status:'scheduled',occurrence_start:start,scheduled_start:start,
    scheduled_for:now,reminder_lead_hours:1,source:'external',source_observed_at:now-3600000,event_start:start,imported_start:start};
  assert.equal(eligibility(row,now),null);
  for(const changed of [{bookmarked:false},{reminders_enabled:false},{occurrence_status:'source_missing'},
    {source_observed_at:now-73*3600000},{event_start:start+60000},{scheduled_start:start+60000},{expires_at:now-1},{event_status:'cancelled'}]) {
    assert.notEqual(eligibility({...row,...changed},now),null);
  }
});
test('mail dates honor Toronto DST, and marketing requires sender contact plus separate unsubscribe',()=>{
  assert.match(formatDate('2026-11-01T05:30:00Z'),/1:30/);
  assert.match(formatDate('2026-11-01T06:30:00Z'),/1:30/);
  const row={user_id:7,delivery_email:'test@example.test',kind:'marketing'};
  assert.throws(()=>buildMessage(row,{key,config:{origin:'https://example.test',sender:'Example',contact:''},events:[]}),/contact/);
  const mail=buildMessage(row,{key,config:{origin:'https://example.test',sender:'Example',contact:'Operator contact configured for test'},
    events:[{title:'Arts day',starts_at:'2026-11-02T15:00:00Z',reason:'Upcoming in Toronto'}]});
  const token=new URL(mail.unsubscribeURL).searchParams.get('token');
  assert.equal(policy.verifyUnsubscribe(token,key).scope,'marketing');
  assert.match(mail.text,/opted in/);
});
