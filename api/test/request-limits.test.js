const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const proxyAddress=require('proxy-addr');
const {createProxyTrust}=require('../services/proxyTrust');
const {createRequestLimits,requestPolicy,requestPolicies,createAdmissionGuard}=require('../services/requestLimits');
const {EventEmitter}=require('node:events');
const {createReadiness}=require('../services/readiness');
function response(){return {code:200,headers:{},set(key,value){this.headers[key]=value;return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}

test('only the configured immediate proxy is trusted; earlier forwarded IPs cannot spoof the client',()=>{
  const trusted=createProxyTrust('10.0.1.0/24');
  const req={socket:{remoteAddress:'10.0.1.9'},headers:{'x-forwarded-for':'1.2.3.4, 198.51.100.9'}};
  assert.equal(proxyAddress(req,trusted),'198.51.100.9');
  assert.equal(proxyAddress({...req,socket:{remoteAddress:'203.0.113.9'}},trusted),'203.0.113.9');
  assert.equal(trusted('::ffff:203.0.113.9',0),false);
  assert.equal(trusted('10.0.1.8',1),false);
  assert.equal(createProxyTrust(),false);
  assert.throws(()=>createProxyTrust('true'));
});
test('verified UID limits cannot be bypassed by changing IP or supplied body identity',async()=>{
  const counts=new Map();
  const limits=createRequestLimits({isReady:true,async eval(_script,{keys}){
    const count=(counts.get(keys[0]) || 0)+1;counts.set(keys[0],count);return [count,60000];
  }});
  for(let i=0;i<31;i++){
    const res=response();const allowed=await limits.authenticated({method:'POST',originalUrl:'/api/bookmarks/1',ip:`192.0.2.${i}`,body:{userId:i}},res,'verified-user');
    assert.equal(allowed,i<30);if(i===30){assert.equal(res.code,429);assert.equal(res.headers['Retry-After'],'60');}
  }
  assert.equal(counts.size,2,'minute and day limits share the verified identity');
  assert.ok(![...counts.keys()][0].includes('verified-user'));
});
test('case and trailing-slash route equivalents select the same abuse policy',()=>{
  for(const [canonical,equivalent] of [['/api/auth/me','/API/AUTH/ME/?refresh=1'],
    ['/api/profiles','/api/PROFILES/'],['/api/notifications/unsubscribe','/API/notifications/UNSUBSCRIBE/']]) {
    assert.deepEqual(requestPolicy({originalUrl:equivalent,method:'POST'},false),requestPolicy({originalUrl:canonical,method:'POST'},false));
  }
  assert.equal(requestPolicy({originalUrl:'/API/NOTIFICATIONS/FEEDBACK/SES/',method:'POST'},false).bucket,'feedback');
});
test('Redis failure blocks guarded API reads and writes promptly while cheap liveness stays available',async()=>{
  const limits=createRequestLimits({isReady:false,eval(){assert.fail('queued unavailable store command');}});
  const blocked=response();let called=false;
  await limits.anonymous({method:'POST',originalUrl:'/api/auth/sync',ip:'192.0.2.1'},blocked,()=>{called=true;});
  assert.equal(called,false);assert.equal(blocked.code,503);
  for(const url of ['/api/events','/api/readyz','/api/notifications/feedback/ses']){
    const res=response();let allowed=false;await limits.anonymous({method:url.includes('feedback')?'POST':'GET',originalUrl:url},res,()=>{allowed=true;});assert.equal(allowed,false);assert.equal(res.code,503);
  }
  let live=false;await limits.anonymous({method:'GET',originalUrl:'/api/healthz'},response(),()=>{live=true;});assert.equal(live,true);
  assert.equal(requestPolicy({method:'POST',originalUrl:'/api/healthz'},false).bucket,'write');
});
test('HEAD and encoded event IDs cannot bypass expensive public read policies',()=>{
  const expected=requestPolicy({originalUrl:'/api/events/1/image',method:'GET'},false);
  for(const originalUrl of ['/api/events/%31/image','/API/EVENTS/1/IMAGE/?v=2']) for(const method of ['GET','HEAD']) {
    assert.deepEqual(requestPolicy({originalUrl,method},false),expected);
  }
  assert.equal(requestPolicy({originalUrl:'/api/events',method:'HEAD'},false).bucket,'catalogue');
  assert.equal(requestPolicy({originalUrl:'/api/events/%31/comments/snapshot',method:'HEAD'},false).bucket,'discussion');
  assert.equal(requestPolicy({originalUrl:'/api/notifications',method:'GET'},true).limit,180);
});
test('storage-producing actions also have daily verified-user budgets',()=>{
  const comment=requestPolicies({originalUrl:'/api/events/%31/comments',method:'POST'},true);
  assert.equal(comment.find(row=>row.bucket==='comment-day').limit,100);
  const event=requestPolicies({originalUrl:'/API/EVENTS/',method:'POST'},true);
  assert.equal(event.find(row=>row.bucket==='event-create-day').limit,10);
  assert.equal(event.find(row=>row.bucket==='write-day').limit,500);
  const suggestion=requestPolicies({originalUrl:'/API/EVENTS/%31/suggestions/',method:'POST'},true);
  assert.equal(suggestion.find(row=>row.bucket==='suggestion-burst').limit,3);
  assert.equal(suggestion.find(row=>row.bucket==='suggestion-day').limit,20);
  const preview=requestPolicies({originalUrl:'/api/event-photo-preview',method:'POST'},true);
  assert.equal(preview.find(row=>row.bucket==='photo-preview').limit,20);
});
test('concurrent expensive reads are bounded and slots release once on response or disconnect',()=>{
  const guard=createAdmissionGuard({maximum:3,catalogue:1});
  const responseEvent=()=>Object.assign(new EventEmitter(),response());
  const a=responseEvent(),b=responseEvent(),c=responseEvent();
  assert.equal(guard({originalUrl:'/api/events',method:'GET'},a),true);
  assert.equal(guard({originalUrl:'/api/events',method:'HEAD'},b),false);assert.equal(b.code,503);
  a.emit('finish');a.emit('close');
  assert.equal(guard({originalUrl:'/api/events',method:'GET'},c),true);c.emit('close');
  const d=responseEvent();assert.equal(guard({originalUrl:'/api/events',method:'GET'},d),true);d.emit('finish');
});
test('readiness coalesces concurrent probes and bounds a hanging dependency',async()=>{
  let queries=0,pings=0;
  const ready=createReadiness({db:{query(){queries++;return new Promise(()=>{});}},redis:{isReady:true,async ping(){pings++;return 'PONG';}},timeoutMs:15,cacheMs:1000});
  const a=response(),b=response();await Promise.all([ready({},a),ready({},b)]);
  assert.equal(queries,1);assert.equal(pings,1);assert.equal(a.code,503);assert.equal(b.code,503);
  assert.deepEqual(a.body.dependencies,{database:'unavailable',redis:'ready'});
  await ready({},response());assert.equal(queries,1);
});
test('readiness reports ready only when both live dependencies respond',async()=>{
  const handler=createReadiness({db:{async query(){return {rows:[{}]};}},redis:{isReady:true,async ping(){return 'PONG';}}});
  const res=response();await handler({},res);assert.equal(res.code,200);assert.equal(res.body.ready,true);
});
test('real local Redis atomically enforces concurrent limits and expires counters',{skip:process.env.RATE_LIMIT_REDIS_TEST!=='1'},async()=>{
  assert.equal(process.env.REDIS_HOST,'127.0.0.1');assert.equal(process.env.REDIS_PORT,'56379');
  const {createClient}=require('redis');
  const client=createClient({socket:{host:process.env.REDIS_HOST,port:Number(process.env.REDIS_PORT),reconnectStrategy:false},password:process.env.REDIS_PASSWORD});
  client.on('error',()=>{});await client.connect();
  const prefix=`rate:test:${process.pid}:${Date.now()}`,uid='concurrency-test-user';
  const key=`${prefix}:uid:${createHash('sha256').update(uid).digest('hex')}:write`;
  try{
    const limits=createRequestLimits(client,{prefix});
    const results=await Promise.all(Array.from({length:40},()=>limits.authenticated({method:'PUT',originalUrl:'/api/me/preferences'},response(),uid)));
    assert.equal(results.filter(Boolean).length,30);assert.equal(await client.get(key),'40');
    assert.ok(await client.pTTL(key)>0);assert.ok(await client.pTTL(key)<=60000);
  }finally{await client.del([key,key.replace(/:write$/,':write-day')]);await client.quit();}
});
