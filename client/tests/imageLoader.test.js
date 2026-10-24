import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageLoader} from '../src/services/imageLoader.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const source=id=>`/api/events/${id}/image?size=thumb&v=1`;
const picture=()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/webp'}});

test('map/list subscribers share a bounded request and cached object URL; cancelling one does not cancel the other',async()=>{
  let complete,signal,requests=0;const loader=createImageLoader({fetchImpl:(_src,options)=>{requests++;signal=options.signal;return new Promise(resolve=>{complete=resolve;});},makeURL:()=> 'blob:shared',revokeURL:()=>{}});
  let shown;const first=loader.subscribe(source(1)),second=loader.subscribe(source(1),{onReady:url=>{shown=url;}});
  first();assert.equal(signal.aborted,false);assert.equal(requests,1);complete(picture());await tick();assert.equal(shown,'blob:shared');second();
  let cached;const third=loader.subscribe(source(1),{onReady:url=>{cached=url;}});assert.equal(cached,'blob:shared');assert.equal(requests,1);third();
});

test('only bounded work starts, and leaving the viewport removes queued work',async()=>{
  const pending=[],requested=[];
  const loader=createImageLoader({concurrency:2,fetchImpl:(src)=>{requested.push(src);return new Promise(resolve=>pending.push(resolve));},makeURL:()=> 'blob:bounded',revokeURL:()=>{}});
  const releases=[1,2,3,4].map(id=>loader.subscribe(source(id)));assert.equal(requested.length,2);releases[2]();
  pending.shift()(picture());await tick();assert.equal(requested.length,3);assert.equal(requested.includes(source(3)),false);
  for(const finish of pending)finish(picture());await tick();for(const release of releases)release();
});

test('temporary busy responses retry after the advertised delay, while unsupported responses fall back without retry',async()=>{
  let requests=0,done;const started=Date.now();
  const loader=createImageLoader({fetchImpl:async()=>++requests===1?new Response('',{status:503,headers:{'Retry-After':'1'}}):picture(),makeURL:()=> 'blob:retry',revokeURL:()=>{}});
  const ready=new Promise(resolve=>{done=resolve;});const release=loader.subscribe(source(1),{onReady:done});await ready;
  assert.equal(requests,2);assert.ok(Date.now()-started>=950);release();
  let errors=0,badRequests=0;
  const bad=createImageLoader({fetchImpl:async()=>{badRequests++;return new Response('<html>',{headers:{'Content-Type':'text/html'}});}});
  const stop=bad.subscribe(source(2),{onError:()=>{errors++;}});await tick();assert.equal(errors,1);assert.equal(badRequests,1);stop();
});

test('submitted remote URLs are never fetched and unreferenced blobs are evicted under the byte budget',async()=>{
  let calls=0;const revoked=[];
  const loader=createImageLoader({maximumBytes:4,fetchImpl:async()=>{calls++;return picture();},makeURL:()=>`blob:${calls}`,revokeURL:url=>revoked.push(url)});
  const invalid=loader.subscribe('https://attacker.example/image');await tick();invalid();assert.equal(calls,0);
  for(const id of [1,2]){let finish;const done=new Promise(resolve=>{finish=resolve;});const release=loader.subscribe(source(id),{onReady:finish});await done;release();}
  assert.equal(revoked.length,1);
});
