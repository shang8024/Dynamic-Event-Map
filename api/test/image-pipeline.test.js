const test=require('node:test'),assert=require('node:assert/strict');
const {createImagePool}=require('../services/imagePool');
const {createImageDelivery}=require('../services/imageDelivery');
const {createThumbnailCache}=require('../services/thumbnailCache');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('downloads can overlap while pool concurrency and pending cancellation remain bounded',async()=>{
  const pool=createImagePool({concurrency:3,maximumQueue:2}),finish=[];let started=0;
  const task=()=>pool.run(()=>{started++;return new Promise(resolve=>finish.push(resolve));});
  const jobs=[task(),task(),task()];await tick();assert.equal(started,3);
  const abort=new AbortController(),cancelled=pool.run(()=>{throw new Error('Cancelled work must not execute');},abort.signal);
  const rejected=assert.rejects(cancelled,error=>error.code==='IMAGE_TIMEOUT');abort.abort();await rejected;
  const fourth=task();await tick();assert.equal(started,3);finish.shift()();await tick();assert.equal(started,4);
  for(const done of finish)done();await Promise.all([...jobs,fourth]);
});

test('API thumbnail requests coalesce across event IDs and use optional shared cache without exposing Redis to the worker',async()=>{
  const cache=new Map();let fetches=0,finish;
  const delivery=createImageDelivery({cache:{get:async key=>cache.get(key),set:async(key,value)=>cache.set(key,value)},
    getImage:async()=>{fetches++;await new Promise(resolve=>{finish=resolve;});return Buffer.from('sanitized');}});
  const url='https://images.unsplash.com/fixture',a=delivery(url,'thumb'),b=delivery(url,'thumb');await tick();assert.equal(fetches,1);finish();
  assert.deepEqual(await a,await b);await delivery(url,'thumb');assert.equal(fetches,1);
});

test('real Redis thumbnail cache has a byte/count ceiling, expiry and a separate namespace from abuse counters',
  {skip:process.env.RATE_LIMIT_REDIS_TEST!=='1'},async()=>{
  assert.equal(process.env.REDIS_HOST,'127.0.0.1');assert.equal(process.env.REDIS_PORT,'56379');
  const {createClient}=require('redis'),redis=createClient({socket:{host:process.env.REDIS_HOST,port:Number(process.env.REDIS_PORT)},password:process.env.REDIS_PASSWORD||undefined});
  await redis.connect();const prefix=`test:thumbnail:${process.pid}:${Date.now()}`;
  try {
    const cache=createThumbnailCache(redis,{prefix,maximumBytes:1500,maximumEntries:2});
    const bytes=Buffer.concat([Buffer.from('RIFFxxxxWEBP'),Buffer.alloc(400)]);
    for(const key of ['a','b','c'])await cache.set(key,bytes);
    assert.equal(await cache.get('a'),null);assert.deepEqual(await cache.get('c'),bytes);
    assert.ok(Number(await redis.get(prefix+':bytes'))<=1500);assert.ok(await redis.zCard(prefix+':order')<=2);
    assert.equal(await redis.get(prefix+':sequence'),'3','eviction order uses an atomic sequence, including same-millisecond writes');
    assert.ok(await redis.ttl(prefix+':sequence')>0);
    await cache.set('expiry',bytes,1);await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(await cache.get('expiry'),null);
    let writes=0;
    const noRoom=createThumbnailCache({isReady:true,info:async()=> 'used_memory:100000000\nmaxmemory:100000000\n',eval:()=>{writes++;}});
    await noRoom.set('no-space',bytes);assert.equal(writes,0);
  } finally {const keys=await redis.keys(prefix+':*');if(keys.length)await redis.del(keys);await redis.quit();}
});
