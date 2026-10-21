import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthContinuation} from '../src/services/authContinuation.js';

test('authentication resumes an action once, after the dialog close frame',()=>{
  const frames=[],calls=[],flow=createAuthContinuation(action=>frames.push(action));
  flow.set(()=>calls.push('create'));
  flow.complete();flow.complete();
  assert.deepEqual(calls,[]);assert.equal(frames.length,1);
  frames.shift()();assert.deepEqual(calls,['create']);
});
test('cancelled and superseded sign-ins never perform an old action',()=>{
  const frames=[],calls=[],flow=createAuthContinuation(action=>frames.push(action));
  flow.set(()=>calls.push('old'));flow.cancel();flow.complete();assert.equal(frames.length,0);
  flow.set(()=>calls.push('old'));flow.complete();flow.cancel();frames.shift()();assert.deepEqual(calls,[]);
  flow.set(()=>calls.push('old'));flow.set(()=>calls.push('save'));flow.complete();frames.shift()();assert.deepEqual(calls,['save']);
});
