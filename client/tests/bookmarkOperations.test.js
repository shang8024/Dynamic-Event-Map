import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../src/services/apiErrors.js';
import {mutateBookmark,removeBookmarkBatch} from '../src/services/bookmarkOperations.js';
const fail=error=>async()=>{throw error;};

test('confirmed bookmark writes need no secondary count request',async()=>{
  let reads=0;const add=async()=>({id:4}),remove=async()=>({});
  for(const save of [true,false]) {
    const result=await mutateBookmark({eventId:1,save,add,remove,list:async()=>{reads++;throw new Error('stats unavailable');}});
    assert.equal(result.ok,true);
  }
  assert.equal(reads,0);
});
test('only a removal 404 means already absent; permission failures stay failures',async()=>{
  for(const status of [401,403,404,429]) {
    const result=await mutateBookmark({eventId:1,save:false,remove:fail(new ApiError('safe',{status})),list:()=>assert.fail('definite failure is not an absence lookup')});
    assert.equal(result.ok,status===404);assert.equal(result.alreadyAbsent,status===404?true:undefined);
  }
  assert.equal((await mutateBookmark({eventId:1,save:true,add:fail(new ApiError('safe',{status:404}))})).ok,false);
});
test('a lost write response is reconciled with actual saved state before claiming a result',async()=>{
  const unavailable=new ApiError('network',{code:'network_error',ambiguous:true});
  for(const save of [true,false]) for(const present of [true,false]) {
    const items=present?[{data:{id:1}}]:[];
    const result=await mutateBookmark({eventId:1,save,add:fail(unavailable),remove:fail(unavailable),list:async()=>({items})});
    assert.equal(result.ok,save===present);assert.equal(result.ambiguous===true,false);assert.equal(result.items,items);
  }
  const unknown=await mutateBookmark({eventId:1,save:false,remove:fail(unavailable),list:fail(new Error('offline'))});
  assert.equal(unknown.ok,false);assert.equal(unknown.ambiguous,true);assert.match(unknown.error.message,/could not confirm/);
});
test('bulk removal reports partial outcomes and waits between requests',async()=>{
  const calls=[],waits=[],progress=[];
  const result=await removeBookmarkBatch([1,2,2,3],{remove:async eventId=>{calls.push(eventId);return {ok:eventId!==2,eventId,error:eventId===2?new ApiError('safe',{status:409}):undefined};},
    wait:async ms=>waits.push(ms),onProgress:row=>progress.push(row)});
  assert.deepEqual(calls,[1,2,3]);assert.deepEqual(waits,[2200,2200]);assert.equal(result.removed,2);assert.deepEqual(result.failed,[2]);
  assert.deepEqual(result.remaining,[]);assert.equal(progress.at(-1).completed,3);
});
test('a rate limit halts queued work and retains only failed/unattempted retry IDs',async()=>{
  const calls=[];
  const result=await removeBookmarkBatch([1,2,3,4],{remove:async eventId=>{calls.push(eventId);return eventId===2?
    {ok:false,eventId,error:new ApiError('wait',{status:429,retryAfter:45})}:{ok:true,eventId};},wait:async()=>{}});
  assert.deepEqual(calls,[1,2]);assert.equal(result.removed,1);assert.deepEqual(result.failed,[2]);assert.deepEqual(result.remaining,[3,4]);assert.equal(result.retryAfter,45);
});
test('unknown write results and account changes stop bulk submission',async()=>{
  const result=await removeBookmarkBatch([1,2],{remove:async eventId=>({ok:false,eventId,ambiguous:true,error:new ApiError('unknown',{ambiguous:true})}),wait:async()=>{}});
  assert.deepEqual(result.uncertain,[1]);assert.deepEqual(result.failed,[]);assert.deepEqual(result.remaining,[2]);
  let calls=0;const cancelled=await removeBookmarkBatch([1],{remove:async()=>{calls++;},shouldStop:()=>true});
  assert.equal(calls,0);assert.deepEqual(cancelled.remaining,[1]);
});
