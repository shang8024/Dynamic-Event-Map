const test=require('node:test');
const assert=require('node:assert/strict');
const {createCommentPreview,createCommentPreviewHandler,cacheKey,CACHE_SECONDS}=require('../services/commentPreview');

const snapshot=(revision=1,text='Latest')=>({revision:String(revision),total:4,comments:[{id:4,text,user:{id:1,name:'Author'},createdAt:'2026-10-01T12:00:00Z'}]});
function redisStore() {
  const values=new Map(),writes=[];
  return {isReady:true,values,writes,async get(key){return values.get(key)||null;},async set(key,value,options){writes.push({key,options});values.set(key,value);}};
}
function response() {return {code:200,headers:{},set(name,value){this.headers[name]=value;return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}

test('a warm preview reads only the current revision and caches for one day',async()=>{
  const redis=redisStore();let reads=0;
  const get=createCommentPreview({redis,db:{async query(_sql,args){reads++;return {rows:[args.length===1?{revision:'1'}:snapshot()]};}}});
  assert.deepEqual(await get(7),snapshot());assert.deepEqual(await get(7),snapshot());
  assert.equal(reads,3,'two revision reads but only one bounded content read');
  assert.equal(redis.writes.length,1);assert.equal(redis.writes[0].key,cacheKey(7,1));
  assert.deepEqual(redis.writes[0].options,{EX:86400});assert.equal(CACHE_SECONDS,86400);
});

test('creation, editing and deletion revisions replace the preview across service instances',async()=>{
  const redis=redisStore();let current=snapshot(1),contentReads=0;
  const db={async query(_sql,args){if(args.length===1) return {rows:[{revision:current.revision}]};contentReads++;return {rows:[current]};}};
  const a=createCommentPreview({db,redis}),b=createCommentPreview({db,redis});
  await a(7);
  for(const [revision,text] of [[2,'Added'],[3,'Edited'],[4,'After deletion']]) {
    current=snapshot(revision,text);assert.deepEqual(await b(7),current);assert.deepEqual(await a(7),current);
  }
  assert.equal(contentReads,4);
});

test('a delayed old fill cannot poison a newer revision cache entry',async()=>{
  const redis=redisStore();let release,started;
  const pending=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  const stale=createCommentPreview({redis,db:{async query(_sql,args){if(args.length===1) return {rows:[{revision:'1'}]};started();await pending;return {rows:[snapshot(1,'Old')]};}}});
  const fresh=createCommentPreview({redis,db:{async query(_sql,args){return {rows:[args.length===1?{revision:'2'}:snapshot(2,'New')]};}}});
  const oldRead=stale(7);await ready;assert.deepEqual(await fresh(7),snapshot(2,'New'));release();await oldRead;
  assert.deepEqual(await fresh(7),snapshot(2,'New'));
  assert.equal(JSON.parse(redis.values.get(cacheKey(7,2))).comments[0].text,'New');
});

test('preview misses cache the revision of the one-statement content snapshot',async()=>{
  const redis=redisStore(),get=createCommentPreview({redis,db:{async query(_sql,args){return {rows:[args.length===1?{revision:'1'}:snapshot(2,'Committed meanwhile')]};}}});
  assert.equal((await get(7)).revision,'2');assert.equal(redis.values.has(cacheKey(7,1)),false);assert.equal(redis.values.has(cacheKey(7,2)),true);
});

test('offline, hanging and corrupt Redis fall back to the bounded database result',async()=>{
  for(const redis of [{isReady:false,get(){assert.fail('offline command queued');}},
    {isReady:true,get:()=>new Promise(()=>{}),set:()=>new Promise(()=>{})},
    {isReady:true,async get(){return '{';},async set(){}},
    {isReady:true,async get(){return JSON.stringify({...snapshot(),comments:Array(4).fill(snapshot().comments[0])});},async set(){}},
    {isReady:true,async get(){return JSON.stringify({...snapshot(),comments:[null]});},async set(){}}]) {
    const get=createCommentPreview({redis,timeoutMs:10,db:{async query(_sql,args){return {rows:[args.length===1?{revision:'1'}:snapshot()]};}}});
    assert.deepEqual(await get(7),snapshot());
  }
});

test('missing events never return a cached preview; invalid IDs never touch dependencies',async()=>{
  const redis=redisStore();redis.values.set(cacheKey(7,1),JSON.stringify(snapshot()));
  const missing=createCommentPreviewHandler({redis,db:{async query(){return {rows:[]};}}});
  const absent=response();await missing({params:{eventId:'7'}},absent);assert.equal(absent.code,404);assert.equal(absent.headers['Cache-Control'],'no-store');
  const invalid=createCommentPreviewHandler({db:{query(){assert.fail('invalid ID reached database');}},redis});
  for(const eventId of ['0','-1','01','abc','2147483648','1 OR 1=1']) {
    const res=response();await invalid({params:{eventId}},res);assert.equal(res.code,400);
  }
});

test('database failures return a retryable generic error without service details',async()=>{
  const handler=createCommentPreviewHandler({db:{async query(){throw new Error('private database address');}},redis:{isReady:false}}),res=response();
  await handler({params:{eventId:'7'}},res);assert.equal(res.code,503);assert.equal(res.headers['Cache-Control'],'no-store');assert.doesNotMatch(JSON.stringify(res.body),/private/);
});
